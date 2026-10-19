import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { posix } from 'path';
import { GpuMonitor, MonitorOptions, ServerSnapshot } from './gpuMonitor';
import { GpuServerProvider } from './serverProvider';
import { decorateGpus, markDuplicateServers, ServerStatus, ServerMetadata } from './fleetModel';
import { TaskEvidence, TaskProcess, TaskQuery, taskReminderTarget, validateTaskPath } from './taskQueries';
import { createReminder, evaluateReminder, jobHasEnded, nextReminderDelay, GpuReminder, ReminderObservation } from './reminders';

const instances = new WeakMap<vscode.ExtensionContext, TaskService>();
const REMINDERS = 'gpu-fleet-viewer.reminders';
const GRANTS = 'gpu-fleet-viewer.taskLogGrants';
interface SnapshotQuery {promise:Promise<ServerSnapshot>;queue:AbortController;users:number;started:boolean;}
export function serverId(host: string): string { return 'host-' + createHash('sha256').update(host).digest('hex').slice(0, 16); }
export function visibleFleet(data: ServerStatus[], masks: Record<string, string[]>): ServerStatus[] {
    return data.map(server => {
        const selected = Object.prototype.hasOwnProperty.call(masks,server.host) ? masks[server.host] : undefined;
        const gpus = selected === undefined ? server.gpus : server.gpus.filter(g => selected.includes(g.index) || selected.includes(g.uuid));
        return {...server,gpus,hiddenGpuCount:server.gpus.length-gpus.length};
    });
}
export class TaskService implements vscode.Disposable {
    static get(context: vscode.ExtensionContext): TaskService {
        let service = instances.get(context);
        if (!service) { service = new TaskService(context); instances.set(context, service); context.subscriptions?.push(service); }
        return service;
    }
    private monitor = new GpuMonitor();
    private events = new EventEmitter();
    private cache = new Map<string, ServerSnapshot>();
    private inflight = new Map<string, SnapshotQuery>();
    private processes = new Map<string, TaskProcess>();
    private reminderTargets = new Map<string, TaskProcess>();
    private logs = new Map<string, Set<string>>();
    private directories = new Map<string, Set<string>>();
    private watches: GpuReminder[];
    private grants: Record<string, string[]>;
    private timer?: NodeJS.Timeout;
    private disposed = false;
    private checking = false;
    private activeQueries=0;
    private queryWaiters:(()=>void)[]=[];
    private writes: Promise<void> = Promise.resolve();
    private async runQuery<T>(operation:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
        this.assertActive(signal);
        while(this.activeQueries>=Math.max(1,Math.min(32,vscode.workspace.getConfiguration('gpu-fleet-viewer').get<number>('maxConcurrentHosts',8)))){
            await new Promise<void>((resolve,reject)=>{
                const resume=()=>{signal?.removeEventListener('abort',cancel);resolve();};
                const cancel=()=>{this.queryWaiters=this.queryWaiters.filter(w=>w!==resume);reject(new Error('Request cancelled.'));};
                this.queryWaiters.push(resume);signal?.addEventListener('abort',cancel,{once:true});
                if(signal?.aborted)cancel();
            });
            this.assertActive(signal);
        }
        this.activeQueries++;
        try{return await operation();}finally{
            this.activeQueries--;
            const available=Math.max(1,Math.min(32,vscode.workspace.getConfiguration('gpu-fleet-viewer').get<number>('maxConcurrentHosts',8)))-this.activeQueries;
            this.queryWaiters.splice(0,Math.max(0,available)).forEach(resume=>resume());
        }
    }
    private constructor(private context: vscode.ExtensionContext) {
        this.watches = context.globalState.get<GpuReminder[]>(REMINDERS, []).flatMap(w => {
            if(!w || typeof w.id !== 'string' || !Number.isFinite(w.createdAt) || !['active','fired','expired','cancelled'].includes(w.status)) return [];
            try { return [{...createReminder({...w},w.createdAt),id:w.id,status:w.status}]; } catch { return []; }
        });
        this.watches.forEach(w => { w.stableSince = undefined; });
        this.grants = context.globalState.get<Record<string,string[]>>(GRANTS, {});
        this.schedule();
    }
    onChange(callback: () => void): vscode.Disposable { this.events.on('change', callback); return { dispose: () => this.events.off('change', callback) }; }
    dispose(): void { this.disposed = true; clearTimeout(this.timer);this.queryWaiters.splice(0).forEach(resume=>resume()); this.events.removeAllListeners(); }
    options(signal?: AbortSignal): MonitorOptions {
        const c = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        return { sshConfigPath: c.get<string>('sshConfigPath','~/.ssh/config'), timeoutSeconds: c.get<number>('sshTimeout',8),
            includeProcessOwners: true, includeProcesses: true, includeHostHealth: true, includeSlurm: c.get<boolean>('enableSlurmIntegration',true), signal };
    }
    hosts(): { host: string; id: string; label: string }[] {
        const metadata = this.context.globalState.get<Record<string,ServerMetadata>>('gpu-fleet-viewer.serverMetadata',{});
        return GpuServerProvider.getHosts().map(h => ({ host:h.host,id:serverId(h.host),label:metadata[h.host]?.alias || h.host }));
    }
    resolve(id: unknown): string {
        const host = this.hosts().find(h => h.id === id);
        if (!host) throw new Error('Choose a currently configured server from the fleet data.');
        return host.host;
    }
    private joinSnapshot(task:SnapshotQuery,signal?:AbortSignal):Promise<ServerSnapshot>{
        task.users++;
        return new Promise((resolve,reject)=>{
            let settled=false;
            const release=()=>{
                if(settled)return false;settled=true;signal?.removeEventListener('abort',cancel);task.users--;
                if(!task.users&&!task.started)task.queue.abort();
                return true;
            };
            const cancel=()=>{if(release())reject(new Error('Request cancelled.'));};
            task.promise.then(value=>{if(release())resolve(value);},error=>{if(release())reject(error);});
            signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
        });
    }
    async snapshot(host: string, options: MonitorOptions, maxAge = 0, monitor = this.monitor): Promise<ServerSnapshot> {
        this.assertActive(options.signal);
        if (!this.hosts().some(h => h.host === host)) throw new Error('Server is no longer configured.');
        const key = JSON.stringify([host,options.sshConfigPath,options.includeProcessOwners,options.includeProcesses,options.includeHostHealth,options.includeSlurm]);
        const cached = this.cache.get(key);
        if (cached && Date.now()-cached.collectedAt < maxAge) return cached;
        const running = this.inflight.get(key);
        if (running&&!running.queue.signal.aborted) return this.joinSnapshot(running,options.signal);
        const state={queue:new AbortController(),users:0,started:false};
        const promise=this.runQuery(()=>{state.started=true;return monitor.getServerSnapshot(host,{...options,signal:undefined});},state.queue.signal)
            .then(value=>{this.cache.set(key,value);return value;}).finally(()=>{if(this.inflight.get(key)?.promise===promise)this.inflight.delete(key);});
        const task=Object.assign(state,{promise});
        this.inflight.set(key,task);
        return this.joinSnapshot(task,options.signal);
    }
    async fleet(ids?: string[],signal?:AbortSignal): Promise<ServerStatus[]> {
        const c = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        const all = this.hosts().filter(h => !ids || ids.includes(h.id));
        const result: ServerStatus[] = [];
        const workers = Math.min(all.length, Math.max(1,Math.min(32,c.get<number>('maxConcurrentHosts',8))));
        let index=0;
        await Promise.all(Array.from({length:workers},async () => {
            while(index<all.length) {
                this.assertActive(signal);
                const entry=all[index++];
                try {
                    const snap=await this.snapshot(entry.host,this.options(signal),5000);
                    result.push({...snap,host:entry.host,metadata:{alias:entry.label},gpus:decorateGpus(snap.gpus,{
                        availabilityRequireNoProcesses:c.get('availabilityRequireNoProcesses',true), availabilityMaxMemoryMiB:c.get('availabilityMaxMemoryMiB',512),availabilityMaxUtilization:c.get('availabilityMaxUtilization',10)
                    }),stale:false,lastSuccessAt:snap.collectedAt});
                } catch {this.assertActive(signal); result.push({host:entry.host,gpus:[],collectedAt:Date.now(),latencyMs:0,stale:true,error:'SSH query failed; no current observations.'}); }
            }
        }));
        return markDuplicateServers(all.flatMap(h => result.filter(s => s.host===h.host)));
    }
    private assertActive(signal?: AbortSignal) { if (signal?.aborted || this.disposed) throw new Error('Request cancelled.'); }
    logLimits(){const c=vscode.workspace.getConfiguration('gpu-fleet-viewer');return {lines:Math.max(20,Math.min(10000,c.get<number>('ai.logTailLines',500))),maxBytes:Math.max(16,Math.min(2048,c.get<number>('ai.logTailKiB',256)))*1024};}
    private rememberDirectory(id:string,path:unknown){
        try {const p=validateTaskPath(path);if(p==='/')return;const paths=this.directories.get(id)||new Set<string>();paths.add(p);this.directories.set(id,paths);} catch { /* Sensitive paths do not become browsing capabilities. */ }
    }
    async query(id: string, kind: TaskQuery, args: Record<string,unknown>, signal?: AbortSignal, allowOnce=false): Promise<any> {
        this.assertActive(signal);
        const host=this.resolve(id);
        if(kind==='files'&&!this.directories.get(id)?.has(validateTaskPath(args.path)))throw new Error('Directory has not been discovered from this task. Inspect its process or Slurm job first, then browse observed child directories.');
        if (kind==='log') {
            const limits=this.logLimits();args={...args,lines:Math.min(Number(args.lines)||limits.lines,limits.lines),maxBytes:Math.min(Number(args.maxBytes)||limits.maxBytes,limits.maxBytes)};
            const path=validateTaskPath(args.path);
            if (!allowOnce && !this.grants[id]?.includes(path)) {
                this.logs.set(id,new Set([...(this.logs.get(id)||[]),path])); this.events.emit('change');
                return { needsAuthorization:true,path,message:'This exact task log needs user authorization. Do not claim to have read it.' };
            }
        }
        if (kind==='process' || (kind==='resources' && args.pid!==undefined)) {
            const snap=await this.snapshot(host,this.options(signal),5000);
            const known=snap.gpus.some(g => g.processes.some(p => p.pid===args.pid)) || (kind==='process' && this.processes.has(id+':'+args.pid));
            if (!known) throw new Error('PID is not associated with a monitored GPU task. Refresh the fleet first.');
        }
        const result=await this.runQuery(()=>this.monitor.queryTask(host,kind,args,this.options(signal)),signal);
        this.assertActive(signal);
        if(kind==='process') {
            const evidence=result as TaskEvidence;
            const key=id+':'+args.pid;
            const previous=this.processes.get(key);
            const root=evidence.chain[0];
            if(previous&&root&&previous.identity!==root.identity){
                this.processes.delete(key);this.reminderTargets.delete(key);
                return {chain:[],children:[],collectedAt:evidence.collectedAt,changedIdentity:true,message:'Original GPU process identity changed. Refresh and select the current task.'};
            }
            if(root)this.processes.set(key,root);
            const target=taskReminderTarget(evidence);
            if(target){this.reminderTargets.set(key,target);this.reminderTargets.set(id+':'+target.pid,target);}
            for(const p of evidence.chain.filter(p=>root&&p.user===root.user&&p.pid!=='1')) {
                const paths=this.logs.get(id)||new Set<string>(); p.logs.forEach(log => { try { paths.add(validateTaskPath(log)); } catch { /* Sensitive paths are not log candidates. */ } }); this.logs.set(id,paths);
                this.rememberDirectory(id,p.cwd);
                for(const log of p.logs)this.rememberDirectory(id,posix.dirname(log));
                for(const entry of p.paths||[])this.rememberDirectory(id,entry.kind==='directory'?entry.path:posix.dirname(entry.path));
            }
            result.browsableDirectories=[...this.directories.get(id)||[]];
        }
        if(kind==='job' && typeof result.detail==='string') {
            for(const match of result.detail.matchAll(/\b(WorkDir|StdOut|StdErr)=(.*?)(?=\s+[A-Za-z][A-Za-z0-9_]*=|$)/g)) {
                try { const p=validateTaskPath(match[2].trim());if(match[1]==='WorkDir')this.rememberDirectory(id,p);
                    else {const paths=this.logs.get(id)||new Set<string>(); paths.add(p); this.logs.set(id,paths);this.rememberDirectory(id,posix.dirname(p));}
                } catch { /* Only safe task paths can be offered. */ }
            }
            result.browsableDirectories=[...this.directories.get(id)||[]];
        }
        if(kind==='files')for(const entry of result.entries||[])if(entry.kind==='directory')this.rememberDirectory(id,entry.path);
        this.events.emit('change');
        return kind==='log' ? {...result,collectedAt:new Date().toISOString()} : result;
    }
    state() {
        const paths=new Map([...this.logs].map(([id,values])=>[id,new Set(values)]));
        for(const [id,grants] of Object.entries(this.grants)){const set=paths.get(id)||new Set<string>();grants.forEach(path=>set.add(path));paths.set(id,set);}
        return { servers:this.hosts().map(({id,label})=>({id,label})),reminders:this.watches,
        logs:[...paths].flatMap(([server,paths])=>[...paths].map(path=>({server,path,authorized:Boolean(this.grants[server]?.includes(path))}))) }; }
    async authorize(id: string, path: string, allow: boolean): Promise<void> {
        if(allow)this.resolve(id); validateTaskPath(path);
        const previous=this.grants[id]||[];
        const next={...this.grants,[id]:allow?[...new Set([...previous,path])]:previous.filter(p=>p!==path)};
        await this.context.globalState.update(GRANTS,next); this.grants=next; this.events.emit('change');
    }
    private async persist(): Promise<void> {
        const value=JSON.parse(JSON.stringify(this.watches));
        const write=this.writes.catch(()=>{}).then(()=>this.context.globalState.update(REMINDERS,value));
        this.writes=write; await write; this.events.emit('change'); this.schedule();
    }
    async manage(input: Record<string,unknown>,signal?:AbortSignal): Promise<any> {
        this.assertActive(signal);
        if(input.action==='list') return this.watches;
        if(input.action==='cancel') {
            const watch=this.watches.find(w=>w.id===input.id&&w.status==='active');
            if(!watch) throw new Error('Active reminder not found.');
            watch.status='cancelled'; try { await this.persist(); } catch(error) { watch.status='active'; throw error; } return watch;
        }
        if(input.action==='update') {
            const index=this.watches.findIndex(w=>w.id===input.id&&w.status==='active');
            if(index<0)throw new Error('Active reminder not found.');
            const old=this.watches[index];const patch:Record<string,unknown>={};
            for(const key of ['at','notBefore','expiresAt'])if(input[key]!==undefined)patch[key]=input[key];
            const updated={...createReminder({...old,...patch}),id:old.id,createdAt:old.createdAt};
            this.watches[index]=updated;try{await this.persist();}catch(error){this.watches[index]=old;throw error;}return updated;
        }
        if(input.action!=='create') throw new Error('Invalid reminder action.');
        this.resolve(input.server);
        const args={...input};
        if(args.mode==='taskEnded' && !args.job) {
            const snap=await this.snapshot(this.resolve(args.server),this.options(signal),5000);
            const job=snap.gpus.flatMap(g=>g.processes).find(p=>p.pid===args.pid)?.slurm?.id;
            if(job)args.job=job;
        }
        if(args.mode==='taskEnded' && !args.job) {
            const proc=this.reminderTargets.get(String(args.server)+':'+args.pid);
            if(!proc) throw new Error('Inspect a verified launcher or Slurm job first. An unresolved worker cannot represent the whole task.');
            args.pid=proc.pid;args.identity=proc.identity;
        }
        const watch=createReminder(args);
        if(watch.mode==='available') {
            const snap=await this.snapshot(this.resolve(watch.server),this.options(signal),5000);
            if(watch.gpuIds.some(id=>!snap.gpus.some(g=>g.uuid===id))) throw new Error('Selected GPU no longer exists on this server.');
        }
        this.assertActive(signal);
        const duplicate=this.watches.find(w=>w.status==='active'&&w.server===watch.server&&w.mode===watch.mode&&JSON.stringify(w.gpuIds.slice().sort())===JSON.stringify(watch.gpuIds.slice().sort())&&w.match===watch.match&&w.pid===watch.pid&&w.identity===watch.identity&&w.job===watch.job&&Math.abs((w.at||0)-(watch.at||0))<1000
            &&(input.expiresAt===undefined||Math.abs(w.expiresAt-watch.expiresAt)<1000)&&(input.notBefore===undefined||Math.abs(w.notBefore-watch.notBefore)<1000));
        if(duplicate) return duplicate;
        if(this.watches.filter(w=>w.status==='active').length>=50) throw new Error('At most 50 active reminders are supported.');
        this.watches=[...this.watches.filter(w=>w.status==='active'||Date.now()-w.createdAt<86400000).slice(-99),watch];
        try { await this.persist(); } catch(error) { this.watches=this.watches.filter(w=>w.id!==watch.id); throw error; }
        return watch;
    }
    private schedule() {
        clearTimeout(this.timer); if(this.disposed) return;
        const delay=nextReminderDelay(this.watches);if(delay===undefined)return;
        this.timer=setTimeout(()=>void this.tick(),delay); this.timer.unref();
    }
    private async tick() {
        if(this.checking||this.disposed) return; this.checking=true;
        try {
            for(const watch of this.watches.filter(w=>w.status==='active')) {
                const now=Date.now(); if(now<watch.notBefore||(watch.mode==='at'&&now<(watch.at||Infinity))) continue;
                let sample:ReminderObservation={online:false,fresh:false}; let suffix='';
                try {
                    const host=this.resolve(watch.server);
                    if(watch.mode==='taskEnded' && now<watch.expiresAt) {
                        if(watch.job) {
                            const job=await this.runQuery(()=>this.monitor.queryTask(host,'job',{job:watch.job},this.options()));
                            sample={online:true,fresh:true,taskEnded:jobHasEnded(watch.job,job.detail,job.accounting)}; suffix=String(job.accounting||job.detail||'').slice(0,500);
                        } else {
                            const result=await this.runQuery(()=>this.monitor.queryTask(host,'process',{pid:watch.pid},this.options())) as TaskEvidence;
                            sample={online:true,fresh:true,taskIdentity:result.chain[0]?.identity||'',taskEnded:['Z','X'].includes(result.chain[0]?.state||'')}; suffix='Task is no longer running with its original identity; exit success is unknown.';
                        }
                    } else if(now<watch.expiresAt) {
                        const fleet=await this.fleet([watch.server]); const server=fleet[0];
                        sample={online:Boolean(server&&!server.error),fresh:Boolean(server&&!server.stale&&!server.duplicateOf),knownGpuIds:server?.gpus.map(g=>g.uuid),availableIds:server?.gpus.filter(g=>g.availability.available).map(g=>g.uuid)};
                        suffix=server&&!server.error?server.gpus.map(g=>'GPU '+g.index+': '+(g.availability.available?'available':'busy')).join(', '):'Server unavailable; state unknown.';
                    }
                    watch.error=undefined;
                } catch { watch.error='Unable to query the configured server; retrying while reminder is valid.'; }
                if(this.watches.find(w=>w.id===watch.id)!==watch||watch.status!=='active')continue;
                const action=evaluateReminder(watch,sample,Date.now());
                if(action) {
                    watch.status=action==='fire'?'fired':'expired';
                    try { await this.persist(); } catch { watch.status='active'; continue; }
                    if(action==='fire'&&!this.disposed) {
                        const label=this.hosts().find(h=>h.id===watch.server)?.label||watch.server;
                        const zh=vscode.env.language.toLowerCase().startsWith('zh');
                        void vscode.window.showInformationMessage(`GPU Fleet · ${label}: ${zh?(watch.mode==='available'?'选定 GPU 已满足空闲条件':watch.mode==='taskEnded'?'任务已结束或不再以原身份运行':'定时检查'):(watch.mode==='available'?'Selected GPUs are available':watch.mode==='taskEnded'?'Task ended or changed identity':'Scheduled check')}. ${suffix}`);
                    }
                }
            }
            this.events.emit('change');
        } finally { this.checking=false; this.schedule(); }
    }
}
