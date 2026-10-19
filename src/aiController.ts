import * as vscode from 'vscode';
import { AiProtocol, aiEndpoint, aiSecretKey, aiTurn, ChatMessage, buildFleetContext, AiTool } from './aiClient';
import { ServerStatus } from './fleetModel';
import { TaskService, serverId, visibleFleet } from './taskService';
import { renderMarkdown } from './markdown';
import { redactTaskText } from './taskQueries';

const string={type:'string'};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[]):AiTool=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false}});
const TOOLS:AiTool[]=[
    tool('get_fleet_status','Get fresh GPUs, owners, memory and availability in the current dashboard scope. Excludes configured hidden GPUs by default.',{servers:{type:'array',items:string}}),
    tool('inspect_task','Trace a GPU PID to parent/launcher, working directory, related children and task log candidates. Use this to identify multiprocessing workers.',{server:string,pid:string},['server','pid']),
    tool('inspect_job','Read Slurm job details/accounting, or the current SSH user queue if job is omitted. EndTime while running is not a training ETA.',{server:string,job:string},['server']),
    tool('inspect_host','Read two short GPU samples, host memory/load, root filesystem space, driver and GPU topology for bottleneck/resource questions.',{server:string,pid:string},['server']),
    tool('read_task_log','Read up to 200 lines/64KiB of an explicitly authorized task log. Unapproved paths require user authorization in sidebar; never bypass it.',{server:string,path:string},['server','path']),
    tool('manage_reminders','Create/list/cancel a reminder only as requested by the user. available requires GPU UUIDs. taskEnded requires a verified launcher PID or Slurm job. Time fields are ISO strings with timezone; default deadline 24h.',{
        action:{type:'string',enum:['create','list','cancel','update']},id:string,server:string,mode:{type:'string',enum:['available','taskEnded','at']},gpuIds:{type:'array',items:string},match:{type:'string',enum:['all','any']},pid:string,job:string,at:string,notBefore:string,expiresAt:string
    },['action'])
];
export class AiController implements vscode.Disposable {
    private history:ChatMessage[]=[];
    private active?:AbortController;
    private disposed=false;
    private tasks:TaskService;
    private listener:vscode.Disposable;
    private scope?:{server:string;uuid?:string;pid?:string};
    constructor(private readonly context:vscode.ExtensionContext,private readonly webview:vscode.Webview,
        private readonly getData:()=>ServerStatus[],private readonly onKeyChange:()=>Promise<void>) {
        this.tasks=TaskService.get(context);
        this.listener=this.tasks.onChange(()=>void this.publishState());
    }
    private configuration() {
        const config=vscode.workspace.getConfiguration('gpu-fleet-viewer');
        return {protocol:config.get<AiProtocol>('ai.protocol','openai'),baseUrl:config.get<string>('ai.baseUrl','https://api.openai.com/v1'),model:config.get<string>('ai.model',''),timeoutSeconds:config.get<number>('ai.timeoutSeconds',60)};
    }
    async isConfigured():Promise<boolean> {
        try {const o=this.configuration();return Boolean(await this.context.secrets.get(aiSecretKey(o.protocol,o.baseUrl)));} catch {return false;}
    }
    reset():void {this.active?.abort();this.active=undefined;this.history=[];if(!this.disposed) void this.webview.postMessage({type:'aiReset'});}
    dispose():void {this.disposed=true;this.reset();this.listener.dispose();}
    private async publishState() {
        if(this.disposed) return;
        let endpoint='';try {endpoint=aiEndpoint(this.configuration().protocol,this.configuration().baseUrl).host;} catch { /* Settings may be incomplete. */ }
        await this.webview.postMessage({type:'aiState',...this.tasks.state(),scope:this.scope,endpoint,local:true});
    }
    async handle(payload:Record<string,unknown>):Promise<boolean> {
        switch(payload.command) {
            case 'setAiKey':
            case 'deleteAiKey': {
                try {
                    const { protocol, baseUrl } = this.configuration();
                    const keyName = aiSecretKey(protocol, baseUrl);
                    if (payload.command === 'deleteAiKey') {
                        await this.context.secrets.delete(keyName);
                        this.reset();
                    } else {
                        const value = await vscode.window.showInputBox({
                            title: `API key · ${aiEndpoint(protocol, baseUrl).host}`,
                            prompt: 'Stored in VS Code SecretStorage for this API endpoint. Never saved in settings.json.',
                            password: true,
                            ignoreFocusOut: true,
                            validateInput: input => !input.trim() || /[\r\n]/.test(input) ? 'Enter a single API key.' : undefined
                        });
                        if (value === undefined) return true;
                        await this.context.secrets.store(keyName, value.trim());
                    }
                    await this.onKeyChange();
                } catch {
                    await vscode.window.showErrorMessage('Unable to update the API key. Check the API URL and VS Code secret storage.');
                }
                return true;
            }
            case 'aiState':
                if(payload.scopeServer===null) this.scope=undefined;
                else if(typeof payload.scopeServer==='string' && this.tasks.hosts().some(h=>h.id===payload.scopeServer)) this.scope={server:payload.scopeServer};
                if(payload.host!==undefined) {
                    const match=this.tasks.hosts().find(h=>h.host===payload.host);
                    if(match) this.scope={server:match.id,uuid:typeof payload.uuid==='string'?payload.uuid:undefined,pid:typeof payload.pid==='string'?payload.pid:undefined};
                }
                await this.publishState();return true;
            case 'authorizeTaskLog': {
                try {
                    if(typeof payload.server!=='string') throw new Error('Choose a server.');
                    let path=payload.path;
                    if(typeof path!=='string') path=await vscode.window.showInputBox({title:'Task log path / 任务日志路径',prompt:'Absolute remote path. Its tail will be sent to your configured AI service when requested. / 读取后会发送到你配置的 API。',ignoreFocusOut:true});
                    if(typeof path!=='string') return true;
                    if(payload.revoke!==true) {
                        const accepted=await vscode.window.showWarningMessage(`Authorize task log / 授权任务日志: ${path}\nThe bounded log tail may be sent to ${aiEndpoint(this.configuration().protocol,this.configuration().baseUrl).host}.`,{modal:true},'Authorize / 授权');
                        if(!accepted) return true;
                    }
                    await this.tasks.authorize(payload.server,path,payload.revoke!==true);
                } catch(error) { await this.webview.postMessage({type:'aiNotice',error:redactTaskText((error as Error).message)}); }
                return true;
            }
            case 'editReminder': {
                const hours=await vscode.window.showInputBox({title:'Reminder validity / 提醒有效期',prompt:'Hours from now (1–720) / 从现在起的小时数',value:'24',validateInput:value=>Number.isFinite(Number(value))&&Number(value)>=1&&Number(value)<=720?undefined:'Enter 1–720 hours / 请输入 1–720 小时'});
                if(hours!==undefined) {try {await this.tasks.manage({action:'update',id:payload.id,expiresAt:Date.now()+Number(hours)*3600000});} catch(error){await this.webview.postMessage({type:'aiNotice',error:(error as Error).message});}} return true;
            }
            case 'cancelReminder':
                try {await this.tasks.manage({action:'cancel',id:payload.id});} catch(error) {await this.webview.postMessage({type:'aiNotice',error:(error as Error).message});} return true;
            case 'watchGpu': {
                try {
                    const host=this.tasks.hosts().find(h=>h.host===payload.host||h.id===payload.server);
                    if(!host||typeof payload.uuid!=='string') throw new Error('Select a monitored GPU.');
                    await this.tasks.manage({action:'create',server:host.id,mode:'available',gpuIds:[payload.uuid]});
                    await this.publishState();
                    await this.webview.postMessage({type:'aiNotice',text:'Release reminder saved · 24h / 已设置释放提醒，有效期 24 小时'});
                } catch(error) {await this.webview.postMessage({type:'aiNotice',error:(error as Error).message});} return true;
            }
            case 'inspectTask': {
                try {
                    const host=this.tasks.hosts().find(h=>h.host===payload.host);
                    if(!host||typeof payload.pid!=='string') throw new Error('Select a monitored task.');
                    const evidence=await this.tasks.query(host.id,'process',{pid:payload.pid});
                    await this.webview.postMessage({type:'taskEvidence',host:payload.host,uuid:payload.uuid,pid:payload.pid,evidence});
                } catch(error) {await this.webview.postMessage({type:'taskEvidence',host:payload.host,uuid:payload.uuid,pid:payload.pid,error:(error as Error).message});} return true;
            }
            case 'openAiLink':
                if(typeof payload.url==='string'&&/^https?:\/\//i.test(payload.url)) {try {await vscode.env.openExternal(vscode.Uri.parse(payload.url));} catch { /* Invalid external URLs are ignored. */ }} return true;
            case 'copyAiText':
                if(typeof payload.text==='string'&&payload.text.length<=128*1024) await vscode.env.clipboard.writeText(payload.text); return true;
            case 'clearAi': this.reset();return true;
            case 'cancelAi': this.active?.abort();return true;
            case 'askAi': await this.ask(payload);return true;
            default:return false;
        }
    }
    private async execute(name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown> {
        if(signal.aborted) throw new Error('Request cancelled.');
        const schema=TOOLS.find(t=>t.name===name);
        if(!schema) throw new Error('This tool is not allowed.');
        const properties=schema.parameters.properties as Record<string,unknown>;
        if(Object.keys(args).some(key=>!Object.prototype.hasOwnProperty.call(properties,key))) throw new Error('Unsupported tool argument.');
        if(name==='manage_reminders') return this.tasks.manage(args);
        if(name==='get_fleet_status') {
            if(args.servers!==undefined&&(!Array.isArray(args.servers)||args.servers.some(id=>typeof id!=='string'))) throw new Error('Invalid server list.');
            const scopeHosts=this.getData().map(s=>serverId(s.host));
            const ids=(args.servers as string[]|undefined)|| (this.scope?[this.scope.server]:(scopeHosts.length?scopeHosts:undefined));
            ids?.forEach(id=>this.tasks.resolve(id));
            const data=await this.tasks.fleet(ids);
            const masks=vscode.workspace.getConfiguration('gpu-fleet-viewer').get<Record<string,string[]>>('visibleGpus',{});
            return JSON.parse(buildFleetContext(visibleFleet(data,masks),false));
        }
        if(typeof args.server!=='string') throw new Error('A configured server ID is required.');
        if(name==='inspect_task') return this.tasks.query(args.server,'process',{pid:args.pid},signal);
        if(name==='inspect_job') return this.tasks.query(args.server,'job',args.job===undefined?{}:{job:args.job},signal);
        if(name==='inspect_host') return this.tasks.query(args.server,'resources',args.pid===undefined?{}:{pid:args.pid},signal);
        if(name==='read_task_log') {
            const result=await this.tasks.query(args.server,'log',{path:args.path},signal);
            if(!result.needsAuthorization)await this.webview.postMessage({type:'taskProgress',host:this.tasks.resolve(args.server),path:args.path,progress:result.progress,modifiedAt:result.modifiedAt,collectedAt:result.collectedAt});
            return result;
        }
        throw new Error('Unsupported tool.');
    }
    private async ask(payload:Record<string,unknown>) {
        if(this.active||this.disposed) return;
        const active=new AbortController();this.active=active;
        const post=async(message:Record<string,unknown>)=>{if(!this.disposed&&this.active===active) await this.webview.postMessage(message);};
        try {
            if(typeof payload.question!=='string'||!payload.question.trim()||payload.question.length>8000) throw new Error('Enter a question of at most 8000 characters.');
            const options=this.configuration();const apiKey=await this.context.secrets.get(aiSecretKey(options.protocol,options.baseUrl))||'';
            const starts=this.history.map((m,i)=>m.role==='user'?i:-1).filter(i=>i>=0);
            const conversation=[...this.history.slice(starts[Math.max(0,starts.length-4)]||0),{role:'user' as const,content:payload.question.trim()}];
            const masks=vscode.workspace.getConfiguration('gpu-fleet-viewer').get<Record<string,string[]>>('visibleGpus',{});
            const context=buildFleetContext(visibleFleet(this.getData(),masks),false)+'\nSelected task: '+JSON.stringify(this.scope||null)+'\nActive reminders: '+JSON.stringify(this.tasks.state().reminders.filter(w=>w.status==='active'));
            let count=0,bytes=0,combined='',tools=TOOLS,stream=true;
            for(let round=0;round<13;round++) {
                if(active.signal.aborted) throw new Error('Request cancelled.');
                let part='';let last=0;
                let result;
                try {
                    result=await aiTurn({...options,apiKey,stream},conversation,context+(tools.length?'':'\nTool execution is unavailable for this provider. State this clearly; use cached facts and general GPU guidance only. Do not claim SSH queries or reminder changes.'),tools,active.signal,delta=>{
                        part+=delta;
                        if(Date.now()-last>70) {last=Date.now();void post({type:'aiDelta',answer:combined+part,html:renderMarkdown(combined+part)});}
                    });
                } catch(error) {
                    if(!count&&tools.length&&[400,404,422].includes((error as any).status)) {
                        tools=[];stream=false;await post({type:'aiStep',name:'compatibility',text:'Provider rejected tools/streaming parameters. Retrying plain GPU chat; tool execution is unavailable. / 服务拒绝工具参数，尝试普通对话。'});continue;
                    }
                    throw error;
                }
                combined+=result.text;
                await post({type:'aiDelta',answer:combined,html:renderMarkdown(combined)});
                conversation.push({role:'assistant',content:result.text,toolCalls:result.toolCalls});
                if(!result.toolCalls.length) {
                    this.history=conversation;
                    await post({type:'aiResult',answer:combined,html:renderMarkdown(combined)});return;
                }
                combined+='\n\n';
                if(count+result.toolCalls.length>12) throw new Error('Tool limit reached; ask a more focused follow-up.');
                for(const call of result.toolCalls) {
                    if(active.signal.aborted) throw new Error('Request cancelled.');
                    count++;
                    await post({type:'aiStep',name:call.name,args:call.arguments,state:'running'});
                    let value:unknown;
                    try {value=await this.execute(call.name,call.arguments,active.signal);} catch(error) {value={error:redactTaskText((error as Error).message).slice(0,1000)};}
                    if(active.signal.aborted) throw new Error('Request cancelled.');
                    let output=JSON.stringify(value);const remaining=128*1024-bytes;
                    if(remaining<=0) throw new Error('Tool evidence limit reached. Continue with a focused question.');
                    if(Buffer.byteLength(output)>Math.min(remaining,70*1024)) output=Buffer.from(output).subarray(0,Math.min(remaining,70*1024)).toString('utf8')+'\n[Evidence truncated]';
                    bytes+=Buffer.byteLength(output);
                    conversation.push({role:'tool',content:output,toolCallId:call.id});
                    await post({type:'aiStep',name:call.name,state:(value as any)?.error?'error':'done',result:output});
                }
            }
            throw new Error('Tool limit reached.');
        } catch(error) {await post({type:'aiResult',error:redactTaskText((error as Error).message)});}
        finally {if(this.active===active)this.active=undefined;void this.publishState();}
    }
}
