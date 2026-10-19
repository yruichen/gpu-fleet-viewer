import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { AiProtocol, aiEndpoint, aiSecretKey, aiTurn, ChatMessage, ToolCall, buildFleetContext, AiTool } from './aiClient';
import { ServerStatus } from './fleetModel';
import { TaskService, serverId, visibleFleet } from './taskService';
import { renderMarkdown } from './markdown';
import { redactTaskText } from './taskQueries';

const string={type:'string'};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[]):AiTool=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false}});
const TOOLS:AiTool[]=[
    tool('get_fleet_status','Get fresh GPUs, owners, memory and availability in the current dashboard scope. Excludes configured hidden GPUs by default.',{servers:{type:'array',items:string}}),
    tool('inspect_task','Inspect a GPU task and its ancestry, arguments, working directories, stdout/stderr destinations, open-file/path metadata and related children. No file contents are read. Returns directories available for exploration.',{server:string,pid:string},['server','pid']),
    tool('inspect_job','Read Slurm job details/accounting, or the current SSH user queue if job is omitted. EndTime while running is not a training ETA.',{server:string,job:string},['server']),
    tool('inspect_host','Read two short GPU samples, host memory/load, root filesystem space, driver and GPU topology for bottleneck/resource questions.',{server:string,pid:string},['server']),
    tool('list_task_files','List one observed task directory, returning child names, kinds, sizes and modification times, never contents. Choose what to explore from actual evidence. No filename/extension filter. Browse discovered subdirectories or page using nextOffset.',{server:string,path:string,offset:{type:'integer',minimum:0,maximum:100000}},['server','path']),
    tool('read_task_log','Read bounded task text: logs, JSON/JSONL/CSV metrics, configs or scripts. Choose head for setup/config and tail (default) for recent output. Calling this tool requests inline exact-file approval if needed and automatically continues; lack of a grant is not a reason to stop investigating or ask the user to find a path. Binary formats are unsupported.',{server:string,path:string,view:{type:'string',enum:['head','tail']}},['server','path']),
    tool('manage_reminders','Create/list/cancel a reminder only as requested by the user. available requires GPU UUIDs. taskEnded requires a verified launcher PID or Slurm job. Time fields are ISO strings with timezone; default deadline 24h.',{
        action:{type:'string',enum:['create','list','cancel','update']},id:string,server:string,mode:{type:'string',enum:['available','taskEnded','at']},gpuIds:{type:'array',items:string},match:{type:'string',enum:['all','any']},pid:string,job:string,at:string,notBefore:string,expiresAt:string
    },['action'])
];
export class AiController implements vscode.Disposable {
    private history:ChatMessage[]=[];
    private approval?:{id:string;server:string;path:string;resolve:(decision:'once'|'remember'|'deny')=>void};
    private active?:AbortController;
    private continuation?:{conversation:ChatMessage[];pending:ToolCall[];context:string};
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
        return {protocol:config.get<AiProtocol>('ai.protocol','openai'),baseUrl:config.get<string>('ai.baseUrl','https://api.openai.com/v1'),model:config.get<string>('ai.model',''),timeoutSeconds:config.get<number>('ai.timeoutSeconds',120)};
    }
    async isConfigured():Promise<boolean> {
        try {const o=this.configuration();return Boolean(await this.context.secrets.get(aiSecretKey(o.protocol,o.baseUrl)));} catch {return false;}
    }
    reset():void {this.active?.abort();this.active=undefined;this.history=[];this.continuation=undefined;if(!this.disposed) void this.webview.postMessage({type:'aiReset'});}
    dispose():void {this.disposed=true;this.reset();this.listener.dispose();}
    private async publishState() {
        if(this.disposed) return;
        let endpoint='';try {endpoint=aiEndpoint(this.configuration().protocol,this.configuration().baseUrl).host;} catch { /* Settings may be incomplete. */ }
        await this.webview.postMessage({type:'aiState',...this.tasks.state(),scope:this.scope,endpoint,local:true});
    }
    async handle(payload:Record<string,unknown>):Promise<boolean> {
        switch(payload.command) {
            case 'resolveAiApproval': {
                const pending=this.approval;
                if(pending&&pending.id===payload.id&&['once','remember','deny'].includes(String(payload.decision)))pending.resolve(payload.decision as 'once'|'remember'|'deny');
                return true;
            }
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
                    if(payload.revoke!==true&&this.approval?.server===payload.server&&this.approval.path===path){this.approval.resolve('remember');return true;}
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
            case 'continueAi': await this.ask({...payload,continuing:true});return true;
            case 'askAi': await this.ask(payload);return true;
            default:return false;
        }
    }
    private async execute(name:string,args:Record<string,unknown>,signal:AbortSignal,operationId?:string):Promise<unknown> {
        if(signal.aborted) throw new Error('Request cancelled.');
        const schema=TOOLS.find(t=>t.name===name);
        if(!schema) throw new Error('This tool is not allowed.');
        const properties=schema.parameters.properties as Record<string,unknown>;
        if(Object.keys(args).some(key=>!Object.prototype.hasOwnProperty.call(properties,key))) throw new Error('Unsupported tool argument.');
        if(name==='manage_reminders') return this.tasks.manage(args,signal);
        if(name==='get_fleet_status') {
            if(args.servers!==undefined&&(!Array.isArray(args.servers)||args.servers.some(id=>typeof id!=='string'))) throw new Error('Invalid server list.');
            const scopeHosts=this.getData().map(s=>serverId(s.host));
            const ids=(args.servers as string[]|undefined)|| (this.scope?[this.scope.server]:(scopeHosts.length?scopeHosts:undefined));
            ids?.forEach(id=>this.tasks.resolve(id));
            const data=await this.tasks.fleet(ids,signal);
            const masks=vscode.workspace.getConfiguration('gpu-fleet-viewer').get<Record<string,string[]>>('visibleGpus',{});
            return JSON.parse(buildFleetContext(visibleFleet(data,masks),false));
        }
        if(typeof args.server!=='string') throw new Error('A configured server ID is required.');
        if(name==='inspect_task') return this.tasks.query(args.server,'process',{pid:args.pid},signal);
        if(name==='inspect_job') return this.tasks.query(args.server,'job',args.job===undefined?{}:{job:args.job},signal);
        if(name==='inspect_host') return this.tasks.query(args.server,'resources',args.pid===undefined?{}:{pid:args.pid},signal);
        if(name==='list_task_files')return this.tasks.query(args.server,'files',{path:args.path,...(args.offset===undefined?{}:{offset:args.offset})},signal);
        if(name==='read_task_log') {
            if(args.view!==undefined&&!['head','tail'].includes(String(args.view)))throw new Error('Invalid text view.');
            const readArgs={path:args.path,...(args.view===undefined?{}:{view:args.view}),...this.tasks.logLimits()};
            let result=await this.tasks.query(args.server,'log',readArgs,signal);
            if(result.needsAuthorization){
                const decision=await this.requestLogApproval(args.server,result.path,signal,operationId,(args.view||'tail') as 'head'|'tail');
                if(decision==='deny')return {denied:true,message:'User declined this log. Use other available evidence and do not ask again unless the user requests it.'};
                if(decision==='remember')await this.tasks.authorize(args.server,result.path,true);
                if(signal.aborted)throw new Error('Request cancelled.');
                result=await this.tasks.query(args.server,'log',readArgs,signal,decision==='once');
            }
            if(!result.needsAuthorization)await this.webview.postMessage({type:'taskProgress',host:this.tasks.resolve(args.server),path:args.path,modifiedAt:result.modifiedAt,collectedAt:result.collectedAt});
            return result;
        }
        throw new Error('Unsupported tool.');
    }
    private async requestLogApproval(server:string,path:string,signal:AbortSignal,operationId?:string,view:'head'|'tail'='tail'):Promise<'once'|'remember'|'deny'> {
        const id=randomUUID();
        if(signal.aborted)throw new Error('Request cancelled.');
        return new Promise((resolve,reject)=>{
            const finish=(decision?:'once'|'remember'|'deny')=>{
                if(this.approval?.id!==id)return;
                this.approval=undefined;signal.removeEventListener('abort',cancel);
                if(!this.disposed)void this.webview.postMessage({type:'aiApprovalResult',id,decision:decision||'cancelled'});
                if(decision&&decision!=='deny'&&!this.disposed)void this.webview.postMessage({type:'aiStep',id:operationId,name:'read_task_log',state:'running',phase:'executing'});
                if(decision)resolve(decision);else reject(new Error('Request cancelled.'));
            };
            const cancel=()=>finish();
            this.approval={id,server,path,resolve:decision=>finish(decision)};
            signal.addEventListener('abort',cancel,{once:true});
            void this.webview.postMessage({type:'aiApproval',id,operationId,server,label:this.tasks.hosts().find(h=>h.id===server)?.label,path,view,
                endpoint:aiEndpoint(this.configuration().protocol,this.configuration().baseUrl).host,maxLines:this.tasks.logLimits().lines,maxBytes:this.tasks.logLimits().maxBytes});
        });
    }
    private compactEvidence(conversation:ChatMessage[]):void {
        const prefix='[Earlier conversation records compacted; excerpts only. Re-query for missing or current facts.]\n';
        let bytes=conversation.reduce((n,m)=>n+Buffer.byteLength(JSON.stringify(m))+1,2);
        if(bytes<=1024*1024)return;
        let excerpts='';
        const previous=conversation.findIndex(m=>m.role==='assistant'&&m.content.startsWith(prefix));
        if(previous>=0){const [m]=conversation.splice(previous,1);excerpts=m.content.slice(prefix.length);bytes-=Buffer.byteLength(JSON.stringify(m))+1;}
        const questions=conversation.filter(m=>m.role==='user'),latestQuestion=questions[questions.length-1];
        while(bytes>768*1024){
            let index=conversation.findIndex(m=>m.role==='assistant'&&m.toolCalls?.length);
            if(index<0)index=conversation.findIndex(m=>m!==latestQuestion);
            if(index<0)break;
            let end=index+1;
            // Remove complete tool groups so neither protocol receives orphaned results.
            if(conversation[index].toolCalls?.length)while(conversation[end]?.role==='tool')end++;
            for(const m of conversation.splice(index,end-index)){
                bytes-=Buffer.byteLength(JSON.stringify(m))+1;
                const text=(m.toolCalls?.length?JSON.stringify(m.toolCalls).slice(0,2048)+'\n':'')+m.content;
                excerpts=(excerpts+'\n'+m.role+': '+(text.length>6144?text.slice(0,1024)+'\n…\n'+text.slice(-5120):text)).slice(-24000);
            }
        }
        conversation.splice(Math.max(0,conversation.findIndex(m=>m.role==='user')+1),0,{role:'assistant',content:prefix+excerpts});
    }
    private async ask(payload:Record<string,unknown>) {
        if(this.active||this.disposed)return;
        const active=new AbortController();this.active=active;
        const post=async(message:Record<string,unknown>)=>{if(!this.disposed&&this.active===active)await this.webview.postMessage(message);};
        let conversation:ChatMessage[]=[],pending:ToolCall[]=[],context='',count=0,combined='';
        try{
            const continuing=payload.continuing===true;
            if(continuing&&!this.continuation)throw new Error('No pending investigation to continue.');
            if(!continuing&&(typeof payload.question!=='string'||!payload.question.trim()||payload.question.length>32000))throw new Error('Enter a question of at most 32000 characters.');
            const preparedAt=Date.now();await post({type:'aiActivity',id:'prepare',phase:'preparing',state:'running',startedAt:preparedAt});
            const options=this.configuration();const apiKey=await this.context.secrets.get(aiSecretKey(options.protocol,options.baseUrl))||'';
            const c=vscode.workspace.getConfiguration('gpu-fleet-viewer');
            const limit=Math.max(0,Math.min(10000,Math.floor(c.get<number>('ai.maxToolCalls',0))));
            if(active.signal.aborted)throw new Error('Request cancelled.');
            if(continuing){const saved=this.continuation;if(!saved)throw new Error('No pending investigation to continue.');conversation=saved.conversation;pending=saved.pending;context=saved.context;}
            else{
                if(this.continuation){
                    this.history=[...this.continuation.conversation,...this.continuation.pending.map(call=>({role:'tool' as const,toolCallId:call.id,content:'Not executed: user started a new question.'}))];
                }
                const starts=this.history.map((m,i)=>m.role==='user'?i:-1).filter(i=>i>=0);
                conversation=[...this.history.slice(starts[Math.max(0,starts.length-8)]||0),{role:'user',content:(payload.question as string).trim()}];
                const masks=c.get<Record<string,string[]>>('visibleGpus',{});
                context=buildFleetContext(visibleFleet(this.getData(),masks),false)+'\nSelected task: '+JSON.stringify(this.scope||null)+'\nActive reminders: '+JSON.stringify(this.tasks.state().reminders.filter(w=>w.status==='active'));
            }
            this.continuation=undefined;
            await post({type:'aiActivity',id:'prepare',phase:'preparing',state:'done',startedAt:preparedAt});
            let tools=TOOLS,stream=true,round=0;
            while(!active.signal.aborted){
                if(!pending.length){
                    this.compactEvidence(conversation);
                    let part='',last=0;const modelId='model-'+round++,startedAt=Date.now();
                    let result;
                    try{
                        result=await aiTurn({...options,apiKey,stream},conversation,context+(tools.length?'':'\nTool execution is unavailable in compatibility mode. Use cached facts/general GPU guidance and state this clearly.'),tools,active.signal,delta=>{
                            part+=delta;if(Date.now()-last>70){last=Date.now();void post({type:'aiDelta',answer:combined+part,html:renderMarkdown(combined+part)});}
                        },event=>{void post({type:'aiActivity',id:modelId,...event,state:'running',startedAt,endpoint:aiEndpoint(options.protocol,options.baseUrl).host,model:options.model});});
                        await post({type:'aiActivity',id:modelId,state:'done',startedAt,text:result.text});
                    }catch(error){
                        await post({type:'aiActivity',id:modelId,state:active.signal.aborted?'cancelled':'error',startedAt,error:(error as Error).message});
                        if(!count&&tools.length&&[400,404,422].includes((error as any).status)){
                            if(stream){stream=false;await post({type:'aiStep',id:'streamCompatibility',name:'compatibility',state:'done',text:'Retrying tool-enabled requests without streaming. / 尝试保留工具能力的非流式请求。'});continue;}
                            tools=[];await post({type:'aiCapability',toolsAvailable:false,text:'This API/model rejected tool requests. This reply is basic chat only; it cannot inspect tasks or create reminders. / 当前 API 或模型拒绝了工具请求。本轮只能普通对话，无法查询任务或创建提醒。'});
                            await post({type:'aiStep',id:'compatibility',name:'compatibility',state:'done',text:'Tool requests were rejected; basic chat only. / 工具请求未被接受，本轮仅普通对话。'});continue;
                        }
                        throw error;
                    }
                    combined+=result.text;
                    await post({type:'aiDelta',answer:combined,html:renderMarkdown(combined)});
                    conversation.push({role:'assistant',content:result.text,toolCalls:result.toolCalls});
                    if(!result.toolCalls.length){this.history=conversation;await post({type:'aiResult',answer:result.text,html:renderMarkdown(result.text)});return;}
                    if(!tools.length)throw new Error('The provider requested unavailable tools in basic chat mode.');
                    if(combined)combined+='\n\n';pending=result.toolCalls.slice();
                }
                if(limit&&count>=limit){
                    this.continuation={conversation,pending,context};
                    await post({type:'aiResult',answer:combined,html:renderMarkdown(combined),paused:true,canContinue:true,completed:count,remaining:pending.length});return;
                }
                const call=pending[0];count++;
                await post({type:'aiStep',id:call.id,name:call.name,args:call.arguments,state:'running',startedAt:Date.now()});
                let value:unknown;
                try{value=await this.execute(call.name,call.arguments,active.signal,call.id);}catch(error){
                    if(active.signal.aborted)throw error;
                    value={error:redactTaskText((error as Error).message).slice(0,2000)};
                }
                let output=JSON.stringify(value);
                if(Buffer.byteLength(output)>1024*1024)output=JSON.stringify({truncated:true,originalBytes:Buffer.byteLength(output),excerpt:output.slice(0,128*1024)+'\n…\n'+output.slice(-512*1024)});
                conversation.push({role:'tool',content:output,toolCallId:call.id});pending.shift();
                await post({type:'aiStep',id:call.id,name:call.name,state:(value as any)?.error?'error':(value as any)?.denied?'denied':'done',result:output});
                if(active.signal.aborted)throw new Error('Request cancelled.');
            }
            throw new Error('Request cancelled.');
        }catch(error){
            if(this.active===active&&!this.disposed&&conversation.length)this.continuation={conversation,pending,context};
            await post({type:'aiResult',error:redactTaskText((error as Error).message),code:(error as any).code,phase:(error as any).phase,status:(error as any).status,canContinue:Boolean(this.continuation)});
        }finally{if(this.active===active)this.active=undefined;void this.publishState();}
    }
}
