import * as cp from 'child_process';
import * as xml2js from 'xml2js';

export interface SlurmJobInfo {
    id: string;
    name: string;
    state: string;
}

export interface GpuProcessInfo {
    pid: string;
    user: string;
    name: string;
    command: string;
    elapsedSeconds: number;
    usedMemory: string;
    slurm?: SlurmJobInfo;
}

export interface GpuInfo {
    index: string;
    uuid: string;
    name: string;
    utilization: { gpu: string; memory: string };
    memory: { total: string; free: string; used: string };
    temperature: { gpu: string };
    power: { draw: string; limit: string };
    fanSpeed: string;
    processes: GpuProcessInfo[];
}

export interface HostHealth {
    load1: number;
    load5: number;
    load15: number;
    memoryTotalMiB: number;
    memoryUsedMiB: number;
    diskTotalMiB: number;
    diskUsedMiB: number;
    uptimeSeconds: number;
}

export interface ServerSnapshot {
    gpus: GpuInfo[];
    health?: HostHealth;
    healthAvailable: boolean;
    slurmAvailable: boolean;
    collectedAt: number;
    latencyMs: number;
}

export interface MonitorOptions {
    timeoutSeconds: number;
    includeProcessOwners: boolean;
    includeProcesses?: boolean;
    includeHostHealth?: boolean;
    includeSlurm?: boolean;
}

interface ProcessDetails {
    user: string;
    elapsedSeconds: number;
    command: string;
}

const PROCESS_MARKER = '__GPU_FLEET_PROCESSES__';
const DETAILS_MARKER = '__GPU_FLEET_PROCESS_DETAILS__';
const HEALTH_MARKER = '__GPU_FLEET_HOST_HEALTH__';
const SLURM_PIDS_MARKER = '__GPU_FLEET_SLURM_PIDS__';
const SLURM_JOBS_MARKER = '__GPU_FLEET_SLURM_JOBS__';
const GPU_QUERY_FIELDS = [
    'index', 'uuid', 'name', 'utilization.gpu', 'utilization.memory',
    'memory.total', 'memory.free', 'memory.used', 'temperature.gpu',
    'power.draw', 'power.limit', 'fan.speed'
].join(',');

export class GpuMonitor {
    public async getGpuStatus(host: string, options: MonitorOptions): Promise<GpuInfo[]> {
        return (await this.getServerSnapshot(host, options)).gpus;
    }

    public async getServerSnapshot(host: string, options: MonitorOptions): Promise<ServerSnapshot> {
        this.validateHost(host);
        const timeoutSeconds = Math.max(2, Math.min(options.timeoutSeconds, 60));
        const startedAt = Date.now();
        const remoteCommand = this.buildRemoteCommand(options);
        const stdout = await this.execSsh(host, remoteCommand, timeoutSeconds);
        const sections = this.splitSections(stdout);
        const processDetails = this.parseProcessDetails(sections.details || '');
        const slurm = this.parseSlurm(
            sections.slurmPids || '',
            sections.slurmJobs || ''
        );
        const gpus = this.parseNvidiaSmiQuery(
            sections.gpu || '',
            sections.processes || '',
            processDetails
        );

        for (const gpu of gpus) {
            for (const process of gpu.processes) {
                const jobId = slurm.pidToJob.get(process.pid);
                if (jobId) {
                    process.slurm = slurm.jobs.get(jobId) || { id: jobId, name: 'N/A', state: 'N/A' };
                }
            }
        }

        const health = this.parseHostHealth(sections.health || '');
        return {
            gpus,
            health,
            healthAvailable: Boolean(health),
            slurmAvailable: slurm.available,
            collectedAt: Date.now(),
            latencyMs: Date.now() - startedAt
        };
    }

    public async getHostHealth(host: string, timeoutSeconds: number): Promise<HostHealth | undefined> {
        this.validateHost(host);
        const timeout = Math.max(2, Math.min(timeoutSeconds, 15));
        const stdout = await this.execSsh(host, this.hostHealthCommand(), timeout);
        return this.parseHostHealth(stdout);
    }

    public parseNvidiaSmiQuery(
        gpuOutput: string,
        processOutput = '',
        details: Map<string, string | ProcessDetails> = new Map()
    ): GpuInfo[] {
        const processesByUuid = new Map<string, GpuProcessInfo[]>();
        for (const line of processOutput.split(/\r?\n/).filter(Boolean)) {
            const [uuid, pid, processName, usedMemory] = this.parseCsvLine(line);
            if (!uuid || !pid) {
                continue;
            }
            const rawDetails = details.get(pid);
            const processDetails = typeof rawDetails === 'string'
                ? { user: rawDetails, elapsedSeconds: 0, command: processName || 'unknown' }
                : rawDetails;
            const processes = processesByUuid.get(uuid) || [];
            processes.push({
                pid,
                user: processDetails?.user || 'unknown',
                name: processName || 'unknown',
                command: processDetails?.command || processName || 'unknown',
                elapsedSeconds: processDetails?.elapsedSeconds || 0,
                usedMemory: this.withUnit(usedMemory, 'MiB')
            });
            processesByUuid.set(uuid, processes);
        }

        return gpuOutput.split(/\r?\n/).filter(Boolean).map(line => {
            const values = this.parseCsvLine(line);
            const [index, uuid, name, gpuUtilization, memoryUtilization, memoryTotal,
                memoryFree, memoryUsed, temperature, powerDraw, powerLimit, fanSpeed] = values;
            return {
                index: this.value(index),
                uuid: this.value(uuid),
                name: this.value(name, 'Unknown GPU'),
                utilization: {
                    gpu: this.withUnit(gpuUtilization, '%'),
                    memory: this.withUnit(memoryUtilization, '%')
                },
                memory: {
                    total: this.withUnit(memoryTotal, 'MiB'),
                    free: this.withUnit(memoryFree, 'MiB'),
                    used: this.withUnit(memoryUsed, 'MiB')
                },
                temperature: { gpu: this.withUnit(temperature, 'C') },
                power: {
                    draw: this.withUnit(powerDraw, 'W'),
                    limit: this.withUnit(powerLimit, 'W')
                },
                fanSpeed: this.withUnit(fanSpeed, '%'),
                processes: processesByUuid.get(uuid) || []
            };
        });
    }

    public async parseNvidiaSmiXml(
        xml: string,
        owners: Map<string, string> = new Map()
    ): Promise<GpuInfo[]> {
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xml);
        const gpus = result?.nvidia_smi_log?.gpu;
        if (!gpus) {
            return [];
        }
        const gpuList = Array.isArray(gpus) ? gpus : [gpus];
        return gpuList.map((gpu: any, index: number) => {
            const processInfo = gpu.processes?.process_info;
            const processList = processInfo ? (Array.isArray(processInfo) ? processInfo : [processInfo]) : [];
            const powerReadings = gpu.power_readings || gpu.gpu_power_readings || {};
            return {
                index: index.toString(),
                uuid: this.value(gpu.uuid),
                name: this.value(gpu.product_name, 'Unknown GPU'),
                utilization: {
                    gpu: this.value(gpu.utilization?.gpu_util),
                    memory: this.value(gpu.utilization?.memory_util)
                },
                memory: {
                    total: this.value(gpu.fb_memory_usage?.total),
                    free: this.value(gpu.fb_memory_usage?.free),
                    used: this.value(gpu.fb_memory_usage?.used)
                },
                temperature: { gpu: this.value(gpu.temperature?.gpu_temp) },
                power: {
                    draw: this.value(powerReadings.power_draw || powerReadings.instant_power_draw),
                    limit: this.value(powerReadings.power_limit || powerReadings.current_power_limit)
                },
                fanSpeed: this.value(gpu.fan_speed),
                processes: processList.map((process: any) => {
                    const pid = this.value(process.pid);
                    const name = this.value(process.process_name, 'unknown');
                    return {
                        pid,
                        user: owners.get(pid) || 'unknown',
                        name,
                        command: name,
                        elapsedSeconds: 0,
                        usedMemory: this.value(process.used_memory)
                    };
                })
            };
        });
    }

    public parseHostHealth(output: string): HostHealth | undefined {
        const line = output.split(/\r?\n/).find(value => /^[-0-9.]+\|/.test(value.trim()));
        if (!line) {
            return undefined;
        }
        const values = line.trim().split('|').map(value => Number.parseFloat(value));
        if (values.length < 8 || values.some(value => !Number.isFinite(value))) {
            return undefined;
        }
        const [load1, load5, load15, totalKiB, availableKiB, diskTotalKiB, diskUsedKiB, uptimeSeconds] = values;
        return {
            load1,
            load5,
            load15,
            memoryTotalMiB: Math.round(totalKiB / 1024),
            memoryUsedMiB: Math.round((totalKiB - availableKiB) / 1024),
            diskTotalMiB: Math.round(diskTotalKiB / 1024),
            diskUsedMiB: Math.round(diskUsedKiB / 1024),
            uptimeSeconds: Math.round(uptimeSeconds)
        };
    }

    private validateHost(host: string): void {
        if (!host || host.startsWith('-') || !/^[A-Za-z0-9_.:@-]+$/.test(host)) {
            throw new Error(`Invalid SSH target: ${host}`);
        }
    }

    private buildRemoteCommand(options: MonitorOptions): string {
        const commands = [
            `nvidia-smi --query-gpu=${GPU_QUERY_FIELDS} --format=csv,noheader,nounits || exit $?`
        ];
        if (options.includeProcesses || options.includeProcessOwners) {
            commands.push(
                `printf '\n${PROCESS_MARKER}\n'`,
                `processes=$(nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits 2>/dev/null || true)`,
                `printf '%s\n' "$processes"`
            );
            if (options.includeProcessOwners) {
                commands.push(
                    `printf '${DETAILS_MARKER}\n'`,
                    `pids=$(printf '%s\n' "$processes" | cut -d, -f2 | tr -d ' ' | paste -sd, -)`,
                    `if [ -n "$pids" ]; then ps -o pid= -o user= -o etimes= -o args= -p "$pids" 2>/dev/null || true; fi`
                );
            }
        }
        if (options.includeHostHealth) {
            commands.push(
                `printf '${HEALTH_MARKER}\n'`,
                this.hostHealthCommand()
            );
        }
        if (options.includeSlurm) {
            commands.push(
                `printf '${SLURM_PIDS_MARKER}\n'`,
                `if command -v scontrol >/dev/null 2>&1; then printf 'available\n'; scontrol listpids 2>/dev/null | awk 'NR > 1 && $1 ~ /^[0-9]+$/ {print $1 "|" $2}'; fi`,
                `printf '${SLURM_JOBS_MARKER}\n'`,
                `if command -v squeue >/dev/null 2>&1; then squeue -h -o '%A|%j|%T' 2>/dev/null || true; fi`
            );
        }
        return commands.join('; ');
    }

    private hostHealthCommand(): string {
        return [
            `loads=$(cat /proc/loadavg 2>/dev/null | awk '{print $1 "|" $2 "|" $3}')`,
            `mem=$(awk '/MemTotal:/ {t=$2} /MemAvailable:/ {a=$2} END {print t "|" a}' /proc/meminfo 2>/dev/null)`,
            `disk=$(df -Pk / 2>/dev/null | awk 'NR==2 {print $2 "|" $3}')`,
            `up=$(cut -d. -f1 /proc/uptime 2>/dev/null)`,
            `if [ -n "$loads" ] && [ -n "$mem" ] && [ -n "$disk" ] && [ -n "$up" ]; then printf '%s|%s|%s|%s\n' "$loads" "$mem" "$disk" "$up"; fi`
        ].join('; ');
    }

    private execSsh(host: string, remoteCommand: string, timeoutSeconds: number): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.execFile('ssh', [
                '-o', 'BatchMode=yes',
                '-o', `ConnectTimeout=${timeoutSeconds}`,
                host,
                remoteCommand
            ], {
                timeout: timeoutSeconds * 1000,
                maxBuffer: 16 * 1024 * 1024
            }, (error, stdout, stderr) => {
                if (error) {
                    if (error.killed || error.signal === 'SIGTERM') {
                        reject(new Error(`GPU query timed out after ${timeoutSeconds} seconds.`));
                        return;
                    }
                    reject(new Error(stderr.trim() || error.message));
                    return;
                }
                resolve(stdout);
            });
        });
    }

    private splitSections(output: string): Record<string, string> {
        const markerNames = new Map([
            [PROCESS_MARKER, 'processes'], [DETAILS_MARKER, 'details'], [HEALTH_MARKER, 'health'],
            [SLURM_PIDS_MARKER, 'slurmPids'], [SLURM_JOBS_MARKER, 'slurmJobs']
        ]);
        const sections: Record<string, string[]> = { gpu: [] };
        let current = 'gpu';
        for (const line of output.split(/\r?\n/)) {
            const next = markerNames.get(line.trim());
            if (next) {
                current = next;
                sections[current] = [];
            } else {
                sections[current].push(line);
            }
        }
        return Object.fromEntries(Object.entries(sections).map(([key, lines]) => [key, lines.join('\n').trim()]));
    }

    private parseProcessDetails(output: string): Map<string, ProcessDetails> {
        const details = new Map<string, ProcessDetails>();
        for (const line of output.split(/\r?\n/)) {
            const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
            if (match) {
                details.set(match[1], {
                    user: match[2],
                    elapsedSeconds: Number.parseInt(match[3], 10) || 0,
                    command: match[4]
                });
            }
        }
        return details;
    }

    private parseSlurm(pidOutput: string, jobOutput: string): {
        available: boolean;
        pidToJob: Map<string, string>;
        jobs: Map<string, SlurmJobInfo>;
    } {
        const pidToJob = new Map<string, string>();
        for (const line of pidOutput.split(/\r?\n/)) {
            const match = line.trim().match(/^(\d+)\|([^|\s]+)$/);
            if (match) {
                pidToJob.set(match[1], match[2]);
            }
        }
        const jobs = new Map<string, SlurmJobInfo>();
        for (const line of jobOutput.split(/\r?\n/)) {
            const [id, name, state] = line.trim().split('|');
            if (id) {
                jobs.set(id, { id, name: name || 'N/A', state: state || 'N/A' });
            }
        }
        return { available: pidOutput.split(/\r?\n/).includes('available'), pidToJob, jobs };
    }

    private parseCsvLine(line: string): string[] {
        const values: string[] = [];
        let value = '';
        let quoted = false;
        for (let index = 0; index < line.length; index += 1) {
            const character = line[index];
            if (character === '"') {
                if (quoted && line[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            } else if (character === ',' && !quoted) {
                values.push(value.trim());
                value = '';
            } else {
                value += character;
            }
        }
        values.push(value.trim());
        return values;
    }

    private withUnit(value: unknown, unit: string): string {
        const normalized = this.value(value);
        return normalized === 'N/A' ? normalized : `${normalized} ${unit}`;
    }

    private value(value: unknown, fallback = 'N/A'): string {
        if (typeof value === 'string' && value.trim()) {
            const normalized = value.trim();
            return /^\[?N\/A\]?$/i.test(normalized) ? 'N/A' : normalized;
        }
        if (typeof value === 'number') {
            return value.toString();
        }
        return fallback;
    }
}
