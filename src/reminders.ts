import { randomUUID } from 'crypto';

export interface GpuReminder {
    id: string; server: string; mode: 'available' | 'taskEnded' | 'at';
    gpuIds: string[]; match: 'all' | 'any'; pid?: string; identity?: string; job?: string;
    at?: number; notBefore: number; expiresAt: number; createdAt: number;
    status: 'active' | 'fired' | 'expired' | 'cancelled'; stableSince?: number; error?: string;
}
export interface ReminderObservation {
    online: boolean; fresh: boolean; availableIds?: string[]; knownGpuIds?: string[];
    taskIdentity?: string; taskEnded?: boolean;
}
export function createReminder(input: Record<string, unknown>, now = Date.now()): GpuReminder {
    if (!['available','taskEnded','at'].includes(String(input.mode)) || typeof input.server !== 'string' || !input.server) throw new Error('Invalid reminder target or mode.');
    const date = (value: unknown, fallback: number) => {
        if(typeof value === 'string' && !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) throw new Error('Reminder times must include a timezone.');
        const n = typeof value === 'string' ? Date.parse(value) : value === undefined ? fallback : Number(value);
        if (!Number.isFinite(n)) throw new Error('Invalid reminder time. Use an ISO date with timezone.');
        return n;
    };
    const watch: GpuReminder = { id: randomUUID(), server: input.server, mode: input.mode as GpuReminder['mode'],
        gpuIds: Array.isArray(input.gpuIds) ? [...new Set(input.gpuIds)] as string[] : [], match: input.match === 'any' ? 'any' : 'all',
        notBefore: date(input.notBefore, now), expiresAt: date(input.expiresAt, now + 86400000), createdAt: now, status: 'active' };
    if (watch.expiresAt <= now || watch.expiresAt <= watch.notBefore || watch.expiresAt > now + 30 * 86400000) throw new Error('Reminder deadline must be after its start and within 30 days.');
    if (watch.mode === 'available' && (!watch.gpuIds.length || watch.gpuIds.length > 64 || watch.gpuIds.some(id => typeof id !== 'string' || !/^GPU-[\w-]+$/.test(id)))) throw new Error('Select valid GPU UUIDs for an availability reminder.');
    if (watch.mode === 'taskEnded') {
        if (typeof input.job === 'string' && /^\d{1,12}(?:_\d{1,8})?$/.test(input.job)) watch.job = input.job;
        else if (typeof input.pid === 'string' && /^[1-9]\d{0,9}$/.test(input.pid) && typeof input.identity === 'string' && input.identity.length < 200) {
            watch.pid = input.pid; watch.identity = input.identity;
        } else throw new Error('A task reminder requires a verified process start identity or Slurm job.');
    }
    if (watch.mode === 'at') {
        watch.at = date(input.at, NaN);
        if (watch.at <= now || watch.at >= watch.expiresAt) throw new Error('Choose a future reminder time before its deadline.');
    }
    return watch;
}
export function evaluateReminder(watch: GpuReminder, sample: ReminderObservation, now = Date.now()): 'fire' | 'expire' | undefined {
    if (watch.status !== 'active') return;
    if (now >= watch.expiresAt) return 'expire';
    if (now < watch.notBefore) return;
    if (watch.mode === 'at') return now >= (watch.at || Infinity) ? 'fire' : undefined;
    if (!sample.online || !sample.fresh) { watch.stableSince = undefined; return; }
    if (watch.mode === 'taskEnded') return sample.taskEnded || (sample.taskIdentity !== undefined && sample.taskIdentity !== watch.identity) ? 'fire' : undefined;
    const known = sample.knownGpuIds || [];
    const free = sample.availableIds || [];
    const matches = watch.match === 'any' ? watch.gpuIds.some(id => free.includes(id)) : watch.gpuIds.every(id => known.includes(id) && free.includes(id));
    if (!matches) { watch.stableSince = undefined; return; }
    if (watch.stableSince === undefined) watch.stableSince = now;
    if (now - watch.stableSince >= 30000) return 'fire';
}

export function jobHasEnded(id:string,detail: string|null,accounting:string|null):boolean {
    const scheduler=detail?.match(/\bJobState=(\w+)/)?.[1];
    const root=accounting?.split(/\r?\n/).map(line=>line.trim().split('|')).find(fields=>fields[0]===id)?.[1];
    const state=scheduler||root||'';
    return /^(COMPLETED|FAILED|CANCELLED|TIMEOUT|OUT_OF_MEMORY|NODE_FAIL|PREEMPTED|BOOT_FAIL)(?:\b|\+)/.test(state);
}

export function nextReminderDelay(watches:GpuReminder[],now=Date.now()):number|undefined {
    const active=watches.filter(w=>w.status==='active');
    if(!active.length)return;
    return Math.max(1000,Math.min(86400000,...active.map(w=>Math.min(w.expiresAt,w.mode==='at'?(w.at||w.expiresAt):Math.max(now+30000,w.notBefore))-now)));
}
