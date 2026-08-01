import * as cp from 'child_process';
import * as xml2js from 'xml2js';

export interface GpuProcessInfo {
    pid: string;
    user: string;
    name: string;
    usedMemory: string;
}

export interface GpuInfo {
    index: string;
    uuid: string;
    name: string;
    utilization: {
        gpu: string;
        memory: string;
    };
    memory: {
        total: string;
        free: string;
        used: string;
    };
    temperature: {
        gpu: string;
    };
    power: {
        draw: string;
        limit: string;
    };
    fanSpeed: string;
    processes: GpuProcessInfo[];
}

export interface MonitorOptions {
    timeoutSeconds: number;
    includeProcessOwners: boolean;
}

const PROCESS_MARKER = '__GPU_SERVER_VIEWER_PROCESS_OWNERS__';
const OWNER_MARKER = '__GPU_SERVER_VIEWER_OWNER_MAP__';
const GPU_QUERY_FIELDS = [
    'index',
    'uuid',
    'name',
    'utilization.gpu',
    'utilization.memory',
    'memory.total',
    'memory.free',
    'memory.used',
    'temperature.gpu',
    'power.draw',
    'power.limit',
    'fan.speed'
].join(',');

export class GpuMonitor {
    public async getGpuStatus(host: string, options: MonitorOptions): Promise<GpuInfo[]> {
        if (!host || host.startsWith('-') || !/^[A-Za-z0-9_.:@-]+$/.test(host)) {
            throw new Error(`Invalid SSH target: ${host}`);
        }

        const timeoutSeconds = Math.max(2, Math.min(options.timeoutSeconds, 60));
        const gpuQuery = `nvidia-smi --query-gpu=${GPU_QUERY_FIELDS} --format=csv,noheader,nounits`;
        const remoteCommand = options.includeProcessOwners
            ? `${gpuQuery} || exit $?; ` +
                `printf '\\n${PROCESS_MARKER}\\n'; ` +
                `processes=$(nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits 2>/dev/null || true); ` +
                `printf '%s' "$processes"; printf '\\n${OWNER_MARKER}\\n'; ` +
                `pids=$(printf '%s\\n' "$processes" | cut -d, -f2 | tr -d ' ' | paste -sd, -); ` +
                `if [ -n "$pids" ]; then ps -o pid=,user= -p "$pids"; fi`
            : gpuQuery;

        return new Promise((resolve, reject) => {
            cp.execFile(
                'ssh',
                [
                    '-o', 'BatchMode=yes',
                    '-o', `ConnectTimeout=${timeoutSeconds}`,
                    host,
                    remoteCommand
                ],
                {
                    timeout: timeoutSeconds * 1000,
                    maxBuffer: 16 * 1024 * 1024
                },
                (error, stdout, stderr) => {
                    if (error) {
                        if (error.killed || error.signal === 'SIGTERM') {
                            reject(new Error(`GPU query timed out after ${timeoutSeconds} seconds.`));
                            return;
                        }
                        const detail = stderr.trim() || error.message;
                        reject(new Error(detail));
                        return;
                    }

                    try {
                        const [gpuOutput, processAndOwners = ''] = stdout.split(`\n${PROCESS_MARKER}\n`, 2);
                        const [processOutput = '', ownerOutput = ''] = processAndOwners.split(`\n${OWNER_MARKER}\n`, 2);
                        resolve(this.parseNvidiaSmiQuery(
                            gpuOutput,
                            processOutput,
                            this.parseProcessOwners(ownerOutput)
                        ));
                    } catch (parseError) {
                        reject(parseError);
                    }
                }
            );
        });
    }

    public parseNvidiaSmiQuery(
        gpuOutput: string,
        processOutput = '',
        owners: Map<string, string> = new Map()
    ): GpuInfo[] {
        const processesByUuid = new Map<string, GpuProcessInfo[]>();

        for (const line of processOutput.split(/\r?\n/).filter(Boolean)) {
            const [uuid, pid, processName, usedMemory] = this.parseCsvLine(line);
            if (!uuid || !pid) {
                continue;
            }
            const processes = processesByUuid.get(uuid) || [];
            processes.push({
                pid,
                user: owners.get(pid) || 'unknown',
                name: processName || 'unknown',
                usedMemory: this.withUnit(usedMemory, 'MiB')
            });
            processesByUuid.set(uuid, processes);
        }

        return gpuOutput.split(/\r?\n/).filter(Boolean).map(line => {
            const [
                index,
                uuid,
                name,
                gpuUtilization,
                memoryUtilization,
                memoryTotal,
                memoryFree,
                memoryUsed,
                temperature,
                powerDraw,
                powerLimit,
                fanSpeed
            ] = this.parseCsvLine(line);

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
                temperature: {
                    gpu: this.withUnit(temperature, 'C')
                },
                power: {
                    draw: this.withUnit(powerDraw, 'W'),
                    limit: this.withUnit(powerLimit, 'W')
                },
                fanSpeed: this.withUnit(fanSpeed, '%'),
                processes: processesByUuid.get(uuid) || []
            };
        });
    }

    public async parseNvidiaSmiXml(xml: string, owners: Map<string, string> = new Map()): Promise<GpuInfo[]> {
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xml);
        const gpus = result?.nvidia_smi_log?.gpu;

        if (!gpus) {
            return [];
        }

        const gpuList = Array.isArray(gpus) ? gpus : [gpus];

        return gpuList.map((gpu: any, index: number) => {
            const processInfo = gpu.processes?.process_info;
            const processList = processInfo
                ? (Array.isArray(processInfo) ? processInfo : [processInfo])
                : [];
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
                temperature: {
                    gpu: this.value(gpu.temperature?.gpu_temp)
                },
                power: {
                    draw: this.value(powerReadings.power_draw || powerReadings.instant_power_draw),
                    limit: this.value(powerReadings.power_limit || powerReadings.current_power_limit)
                },
                fanSpeed: this.value(gpu.fan_speed),
                processes: processList.map((process: any) => {
                    const pid = this.value(process.pid);
                    return {
                        pid,
                        user: owners.get(pid) || 'unknown',
                        name: this.value(process.process_name, 'unknown'),
                        usedMemory: this.value(process.used_memory)
                    };
                })
            };
        });
    }

    private parseProcessOwners(output: string): Map<string, string> {
        const owners = new Map<string, string>();
        for (const line of output.split(/\r?\n/)) {
            const match = line.trim().match(/^(\d+)\s+(\S+)$/);
            if (match) {
                owners.set(match[1], match[2]);
            }
        }
        return owners;
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
