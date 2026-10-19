export type TaskQuery = 'process' | 'job' | 'resources' | 'log' | 'files';
export interface TaskProcess {
    pid: string; ppid: string; identity: string; user: string; command: string;
    cwd?: string; elapsedSeconds: number; state: string; logs: string[];
    paths?: {path:string;kind:'directory'|'file';source:string}[];
}
export interface TaskEvidence { chain: TaskProcess[]; children: TaskProcess[]; collectedAt: string; }

export function redactTaskText(text: string): string {
    return text.replace(/((?:api[_-]?key|access[_-]?token|token|password|passwd|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
        .replace(/((?:--)(?:api[_-]?key|access[_-]?token|token|password|passwd|secret|authorization)\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1[REDACTED]');
}

export function validateTaskPath(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || [...value].some(ch => ch.charCodeAt(0)<32 || ch.charCodeAt(0)===127)
        || value.split('/').includes('..')) throw new Error('Use an absolute task log path without parent traversal.');
    if (/(?:^|\/)(?:\.ssh|\.aws|\.azure|\.config|\.kube|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.env(?:\.[^/]*)?|id_rsa|id_ed25519|credentials|shadow|passwd)(?:\/|$)/i.test(value)
        || /^\/(?:proc|sys|dev|etc)(?:\/|$)/.test(value)) throw new Error('Sensitive/system paths cannot be read as task logs.');
    return value;
}

const QUERY_SCRIPT = String.raw`
import os,sys,json,time,stat,subprocess,pwd,re,shlex
kind,args=json.loads(sys.argv[1])
def safe_path(p):
    return p.startswith('/') and not re.search(r'(?:^|/)(?:\.ssh|\.aws|\.azure|\.config|\.kube|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.env(?:\.[^/]*)?|id_rsa|id_ed25519|credentials|shadow|passwd)(?:/|$)',p,re.I) and not re.match(r'^/(?:proc|sys|dev|etc)(?:/|$)',p)
def public_argv(argv):
    values=[]; secret=False
    for value in argv:
        if secret: values.append('[REDACTED]'); secret=False; continue
        if re.match(r'^--?(?:api[_-]?key|access[_-]?token|token|password|passwd|secret|authorization)(?:=|$)',value,re.I):
            values.append(value.split('=',1)[0]+('=[REDACTED]' if '=' in value else '')); secret='=' not in value
        else: values.append(value)
    return values
def run(argv):
    try:
        p=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=4)
        return p.stdout[:32768].decode('utf-8','replace') if p.returncode==0 else None
    except (OSError,subprocess.TimeoutExpired): return None
def proc(pid,discover=False):
    try:
        with open('/proc/'+pid+'/stat') as f: raw=f.read(8192)
        fields=raw[raw.rfind(')')+2:].split()
        with open('/proc/'+pid+'/cmdline','rb') as f: argv=f.read(32768).decode('utf-8','replace').rstrip('\0').split('\0')
        argv=public_argv(argv)
        cmd=' '.join(shlex.quote(value) for value in argv).strip()
        with open('/proc/uptime') as f: up=float(f.read().split()[0])
        info=os.stat('/proc/'+pid)
        logs=[]; output=[]; paths=[]
        for fd in ('1','2'):
            try:
                target=os.readlink('/proc/'+pid+'/fd/'+fd)
                regular=stat.S_ISREG(os.stat('/proc/'+pid+'/fd/'+fd).st_mode)
                output.append(dict(fd=fd,target=target,regularFile=regular))
                if regular and target.startswith('/') and os.path.isfile(target) and safe_path(os.path.realpath(target)): logs.append(os.path.realpath(target))
            except OSError: output.append(dict(fd=fd,unreadable=True))
        try: cwd=os.readlink('/proc/'+pid+'/cwd')
        except OSError: cwd=None
        if discover:
            candidates=[(value.split('=',1)[-1],'argument') for value in argv[1:256]]
            try:
                for fd in os.listdir('/proc/'+pid+'/fd')[:128]:
                    try: candidates.append((os.readlink('/proc/'+pid+'/fd/'+fd),'open-file'))
                    except OSError: pass
            except OSError: pass
            seen_paths=set()
            for value,source in candidates:
                if not value or value.startswith('-') or (not value.startswith('/') and not cwd): continue
                p=os.path.realpath(value if value.startswith('/') else os.path.join(cwd,value))
                if not safe_path(p) or p in seen_paths: continue
                try:
                    mode=os.stat(p).st_mode
                    if stat.S_ISDIR(mode) or stat.S_ISREG(mode): paths.append(dict(path=p,kind='directory' if stat.S_ISDIR(mode) else 'file',source=source)); seen_paths.add(p)
                except OSError: pass
        try: user=pwd.getpwuid(info.st_uid).pw_name
        except KeyError: user=str(info.st_uid)
        with open('/proc/sys/kernel/random/boot_id') as f: boot=f.read().strip()
        return dict(pid=pid,ppid=fields[1],identity=boot+':'+fields[19],user=user,command=cmd,cwd=cwd,state=fields[0],cpuTimeSeconds=(int(fields[11])+int(fields[12]))/os.sysconf('SC_CLK_TCK'),residentMiB=int(fields[21])*os.sysconf('SC_PAGE_SIZE')/1048576,elapsedSeconds=max(0,int(up-int(fields[19])/os.sysconf('SC_CLK_TCK'))),logs=list(set(logs)),output=output,paths=paths)
    except (OSError,ValueError,IndexError): return None
if kind=='process':
    if not os.path.isdir('/proc/self'): raise ValueError('Linux /proc is required for task investigation')
    pid=args['pid']; exists=os.path.exists('/proc/'+pid); chain=[]; seen=set()
    for depth in range(9):
        if pid in seen or pid in ('0','1'): break
        seen.add(pid); p=proc(pid,True)
        if not p: break
        if chain and (p['user']!=chain[0]['user'] or re.match(r'^(?:/[^ ]*/)?(?:sshd|systemd|init|login|tmux|screen|[-]?(?:ba|z|fi)?sh)(?: |$)',p['command'])): break
        chain.append(p); pid=p['ppid']
    if exists and not chain: raise PermissionError('Process exists but its details are not readable')
    children=[]
    try:
        with open('/proc/'+args['pid']+'/task/'+args['pid']+'/children') as f: ids=f.read(8192).split()[:64]
        children=[p for p in (proc(i) for i in ids) if p]
    except OSError: pass
    print(json.dumps(dict(chain=chain,children=children,collectedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))))
elif kind=='files':
    p=args['path']; offset=args.get('offset',0)
    if os.path.realpath(p)!=p: raise ValueError('Directory must be canonical and cannot be a symlink')
    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    entries=[]; next_offset=None
    try:
        with os.scandir(fd) as scan:
            for index,entry in enumerate(scan):
                if index<offset: continue
                if index-offset>=4096 or len(entries)>=256: next_offset=index; break
                child=os.path.join(p,entry.name)
                if not safe_path(child) or entry.is_symlink(): continue
                try:
                    info=entry.stat(follow_symlinks=False)
                    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)): continue
                    entries.append(dict(path=child,kind='directory' if stat.S_ISDIR(info.st_mode) else 'file',size=info.st_size,modifiedAt=info.st_mtime))
                except OSError: pass
    finally: os.close(fd)
    print(json.dumps(dict(path=p,entries=entries,nextOffset=next_offset,collectedAt=time.time(),contentsRead=False)))
elif kind=='log':
    p=args['path']
    if os.path.realpath(p)!=p: raise ValueError('Log path must be canonical and cannot be a symlink')
    fd=os.open(p,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode): raise ValueError('Only regular task files are allowed')
        limit=args.get('maxBytes',65536); lines_limit=args.get('lines',200)
        view=args.get('view','tail')
        os.lseek(fd,0 if view=='head' else max(0,info.st_size-limit),os.SEEK_SET)
        raw=os.read(fd,limit).decode('utf-8','replace')
        if '\x00' in raw: raise ValueError('Binary files are not task logs')
        lines=raw.splitlines()
        print(json.dumps(dict(path=p,text='\n'.join(lines[:lines_limit] if view=='head' else lines[-lines_limit:]),view=view,modifiedAt=info.st_mtime,size=info.st_size,truncated=info.st_size>limit or len(lines)>lines_limit)))
    finally: os.close(fd)
elif kind=='job':
    j=args.get('job')
    if j:
        print(json.dumps(dict(job=j,detail=run(['scontrol','show','job','-o',j]),accounting=run(['sacct','-n','-P','-j',j,'--format=JobID,State,ExitCode,Elapsed,Start,End,Timelimit']),collectedAt=time.time())))
    else:
        print(json.dumps(dict(queue=run(['squeue','-h','-u',pwd.getpwuid(os.getuid()).pw_name,'-o','%i|%j|%T|%R|%S|%M|%l']),collectedAt=time.time())))
elif kind=='resources':
    gpu=['nvidia-smi','--query-gpu=index,uuid,name,driver_version,utilization.gpu,memory.used,memory.total','--format=csv,noheader']
    before=proc(args['pid']) if args.get('pid') else None
    first=run(gpu); time.sleep(1); second=run(gpu)
    after=proc(args['pid']) if args.get('pid') else None
    cwd=after.get('cwd') if after else None
    def read(p):
        try:
            with open(p) as f: return f.read(8192)
        except OSError: return None
    print(json.dumps(dict(gpuSamples=[first,second],processSamples=[before,after],sampleIntervalSeconds=1,topology=run(['nvidia-smi','topo','-m']),load=read('/proc/loadavg'),memory=read('/proc/meminfo'),disk=run(['df','-Pk','--',cwd or '/']),collectedAt=time.time())))
`;

export function taskCommand(kind: TaskQuery, args: Record<string, unknown>): string {
    const safe: Record<string, string | number> = {};
    if (kind === 'process') {
        if (typeof args.pid !== 'string' || !/^[1-9]\d{0,9}$/.test(args.pid)) throw new Error('Invalid PID.');
        safe.pid = args.pid;
    } else if (kind === 'job') {
        if (args.job !== undefined) {
            if (typeof args.job !== 'string' || !/^\d{1,12}(?:_\d{1,8})?$/.test(args.job)) throw new Error('Invalid job ID.');
            safe.job = args.job;
        }
    } else if (kind === 'files') {
        safe.path=validateTaskPath(args.path);
        if(args.offset!==undefined){if(typeof args.offset!=='number'||!Number.isInteger(args.offset)||args.offset<0||args.offset>100000)throw new Error('Invalid directory offset.');safe.offset=args.offset;}
    } else if (kind === 'log') {
        safe.path=validateTaskPath(args.path);
        if(args.view!==undefined){if(!['head','tail'].includes(String(args.view)))throw new Error('Invalid text view.');safe.view=String(args.view);}
        for(const [key,max] of [['lines',10000],['maxBytes',2097152]] as const){
            if(args[key]!==undefined){if(typeof args[key]!=='number'||!Number.isInteger(args[key])||Number(args[key])<1||Number(args[key])>max)throw new Error('Invalid log read limit.');safe[key]=args[key] as number;}
        }
    }
    else if (kind === 'resources') {
        if(args.pid !== undefined) {
            if(typeof args.pid !== 'string' || !/^[1-9]\d{0,9}$/.test(args.pid)) throw new Error('Invalid PID.');
            safe.pid=args.pid;
        }
    } else throw new Error('Unsupported task query.');
    const quote = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'";
    return 'python3 -c ' + quote(QUERY_SCRIPT) + ' ' + quote(JSON.stringify([kind, safe]));
}

export function taskReminderTarget(evidence: TaskEvidence): TaskProcess | undefined {
    const root=evidence.chain[0];
    if(!root || !root.command.trim()) return;
    const worker=(p:TaskProcess)=>/multiprocessing[.\s]|spawn_main|multiprocessing-fork|resource_tracker|pt_data_worker/i.test(p.command);
    const parents=evidence.chain.slice(1).filter(p=>p.user===root.user&&p.pid!=='1');
    const launcher=parents.find(p=>/\b(?:torchrun|deepspeed|mpirun|mpiexec|srun)\b|\baccelerate\s+launch\b|python[\d.]*\s+-m\s+torch\.distributed\.run/.test(p.command));
    if(launcher)return launcher;
    const sameCommand=parents.filter(p=>p.command===root.command).pop();
    if(sameCommand)return sameCommand;
    if(!worker(root)) return root;
    return parents.find(p=>p.user===root.user&&p.pid!=='1'&&!worker(p)&&/(?:\bpython[\d.]*\s+(?:-u\s+)?(?:\S+\.py\b|-m\s+\S+)|\b(?:torchrun|accelerate|deepspeed)\b)/.test(p.command));
}
