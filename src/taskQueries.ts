export type TaskQuery = 'process' | 'job' | 'resources' | 'log';
export interface TaskProcess {
    pid: string; ppid: string; identity: string; user: string; command: string;
    cwd?: string; elapsedSeconds: number; state: string; logs: string[];
}
export interface TaskEvidence { chain: TaskProcess[]; children: TaskProcess[]; collectedAt: string; }

export function redactTaskText(text: string): string {
    return text.replace(/((?:api[_-]?key|access[_-]?token|token|password|passwd|secret|authorization)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
        .replace(/((?:--)(?:api[_-]?key|token|password|secret)\s+)\S+/gi, '$1[REDACTED]');
}

export function validateTaskPath(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || [...value].some(ch => ch.charCodeAt(0)<32 || ch.charCodeAt(0)===127)
        || value.split('/').includes('..')) throw new Error('Use an absolute task log path without parent traversal.');
    if (/(?:^|\/)(?:\.ssh|\.aws|\.azure|\.config|\.kube|\.env(?:\.[^/]*)?|id_rsa|id_ed25519|credentials|shadow|passwd)(?:\/|$)/i.test(value)
        || /^\/(?:proc|sys|dev|etc)(?:\/|$)/.test(value)) throw new Error('Sensitive/system paths cannot be read as task logs.');
    return value;
}

const QUERY_SCRIPT = String.raw`
import os,sys,json,time,stat,subprocess,pwd,re
kind,args=json.loads(sys.argv[1])
def run(argv):
    try:
        p=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=4)
        return p.stdout[:32768].decode('utf-8','replace') if p.returncode==0 else None
    except (OSError,subprocess.TimeoutExpired): return None
def proc(pid):
    try:
        with open('/proc/'+pid+'/stat') as f: raw=f.read(8192)
        fields=raw[raw.rfind(')')+2:].split()
        with open('/proc/'+pid+'/cmdline','rb') as f: cmd=f.read(16384).replace(b'\0',b' ').decode('utf-8','replace').strip()
        with open('/proc/uptime') as f: up=float(f.read().split()[0])
        info=os.stat('/proc/'+pid)
        logs=[]
        for fd in ('1','2'):
            try:
                target=os.readlink('/proc/'+pid+'/fd/'+fd)
                if target.startswith('/') and stat.S_ISREG(os.stat(target).st_mode): logs.append(os.path.realpath(target))
            except OSError: pass
        try: cwd=os.readlink('/proc/'+pid+'/cwd')
        except OSError: cwd=None
        try: user=pwd.getpwuid(info.st_uid).pw_name
        except KeyError: user=str(info.st_uid)
        with open('/proc/sys/kernel/random/boot_id') as f: boot=f.read().strip()
        return dict(pid=pid,ppid=fields[1],identity=boot+':'+fields[19],user=user,command=cmd,cwd=cwd,state=fields[0],cpuTimeSeconds=(int(fields[11])+int(fields[12]))/os.sysconf('SC_CLK_TCK'),residentMiB=int(fields[21])*os.sysconf('SC_PAGE_SIZE')/1048576,elapsedSeconds=max(0,int(up-int(fields[19])/os.sysconf('SC_CLK_TCK'))),logs=list(set(logs)))
    except (OSError,ValueError,IndexError): return None
if kind=='process':
    if not os.path.isdir('/proc/self'): raise ValueError('Linux /proc is required for task investigation')
    pid=args['pid']; exists=os.path.exists('/proc/'+pid); chain=[]; seen=set()
    for depth in range(9):
        if pid in seen or pid in ('0','1'): break
        seen.add(pid); p=proc(pid)
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
elif kind=='log':
    p=args['path']
    if os.path.realpath(p)!=p: raise ValueError('Log path must be canonical and cannot be a symlink')
    fd=os.open(p,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode): raise ValueError('Only regular task files are allowed')
        os.lseek(fd,max(0,info.st_size-65536),os.SEEK_SET)
        raw=os.read(fd,65536).decode('utf-8','replace')
        if '\x00' in raw: raise ValueError('Binary files are not task logs')
        lines=raw.splitlines()
        print(json.dumps(dict(path=p,text='\n'.join(lines[-200:]),modifiedAt=info.st_mtime,size=info.st_size,truncated=info.st_size>65536 or len(lines)>200)))
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
    const safe: Record<string, string> = {};
    if (kind === 'process') {
        if (typeof args.pid !== 'string' || !/^[1-9]\d{0,9}$/.test(args.pid)) throw new Error('Invalid PID.');
        safe.pid = args.pid;
    } else if (kind === 'job') {
        if (args.job !== undefined) {
            if (typeof args.job !== 'string' || !/^\d{1,12}(?:_\d{1,8})?$/.test(args.job)) throw new Error('Invalid job ID.');
            safe.job = args.job;
        }
    } else if (kind === 'log') safe.path = validateTaskPath(args.path);
    else if (kind === 'resources') {
        if(args.pid !== undefined) {
            if(typeof args.pid !== 'string' || !/^[1-9]\d{0,9}$/.test(args.pid)) throw new Error('Invalid PID.');
            safe.pid=args.pid;
        }
    } else throw new Error('Unsupported task query.');
    const quote = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'";
    return 'python3 -c ' + quote(QUERY_SCRIPT) + ' ' + quote(JSON.stringify([kind, safe]));
}

export interface TaskProgress { current: number; total: number; unit: string; remainingSeconds?: number; basis: string; }
export function parseProgress(text: string): TaskProgress | undefined {
    const points: { current: number; total: number; unit: string; time?: number; speed?: number }[] = [];
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/\b(step|epoch)s?\s*[:=]?\s*(\d+)\s*\/\s*(\d+)/i) || line.match(/()(\d+)\s*\/\s*(\d+).*?(?:it\/s|s\/it)/i);
        if (!match) continue;
        const current = Number(match[2]), total = Number(match[3]);
        if (!total || current > total) continue;
        const speedMatch = line.match(/([\d.]+)\s*(it\/s|s\/it)/);
        const stamp = line.match(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?/);
        points.push({ current, total, unit: match[1]?.toLowerCase() || 'step', time: stamp ? Date.parse(stamp[0]) : undefined,
            speed: speedMatch ? (speedMatch[2] === 'it/s' ? Number(speedMatch[1]) : 1 / Number(speedMatch[1])) : undefined });
    }
    const last = points[points.length - 1];
    if (!last) return undefined;
    const previous = points[points.length - 2];
    let speed = last.speed;
    if (previous && previous.total === last.total && previous.unit === last.unit && last.current > previous.current && last.time && previous.time && last.time > previous.time) {
        speed = (last.current - previous.current) / ((last.time - previous.time) / 1000);
    }
    return { current: last.current, total: last.total, unit: last.unit,
        ...(speed && Number.isFinite(speed) && speed > 0 ? { remainingSeconds: Math.round((last.total - last.current) / speed) } : {}),
        basis: 'Current phase only; validation, checkpoint saving and later phases may add time. Log freshness must be checked.' };
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
