import { GpuInfo, HostHealth } from './gpuMonitor';

export interface AvailabilitySettings {
    availabilityRequireNoProcesses: boolean;
    availabilityMaxMemoryMiB: number;
    availabilityMaxUtilization: number;
}

export interface AvailabilityResult {
    available: boolean;
    reasons: string[];
}

export interface FleetGpuInfo extends GpuInfo {
    availability: AvailabilityResult;
}

export type ServerErrorCategory =
    'timeout' | 'authentication' | 'host-not-found' | 'unreachable' | 'nvidia-smi' | 'unknown';

export interface ServerMetadata {
    alias?: string;
    group?: string;
    favorite?: boolean;
}

export interface ServerStatus {
    host: string;
    gpus: FleetGpuInfo[];
    health?: HostHealth;
    collectedAt: number;
    latencyMs: number;
    lastSuccessAt?: number;
    stale: boolean;
    metadata?: ServerMetadata;
    duplicateOf?: string;
    slurmAvailable?: boolean;
    healthAvailable?: boolean;
    error?: string;
    errorCategory?: ServerErrorCategory;
}

export interface GpuStatusSummary {
    serversOnline: number;
    serversTotal: number;
    gpusAvailable: number;
    gpusTotal: number;
    warnings: number;
    memoryPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    utilizationPercent: number;
    powerDraw: number;
    powerLimit: number;
    updatedAt: number;
}

export interface UserSummary {
    user: string;
    gpuCount: number;
    processCount: number;
    memoryMiB: number;
}

export function numberValue(value: string | number | undefined): number {
    const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function percent(value: string, total: string): number {
    const denominator = numberValue(total);
    return denominator > 0 ? (numberValue(value) / denominator) * 100 : 0;
}

export function evaluateAvailability(
    gpu: GpuInfo,
    settings: AvailabilitySettings
): AvailabilityResult {
    const reasons: string[] = [];
    const usedMemory = numberValue(gpu.memory.used);
    const utilization = numberValue(gpu.utilization.gpu);

    if (settings.availabilityRequireNoProcesses && gpu.processes.length > 0) {
        reasons.push(`${gpu.processes.length} compute process${gpu.processes.length === 1 ? '' : 'es'}`);
    }
    if (usedMemory > settings.availabilityMaxMemoryMiB) {
        reasons.push(`${Math.round(usedMemory)} MiB memory used`);
    }
    if (utilization > settings.availabilityMaxUtilization) {
        reasons.push(`${Math.round(utilization)}% utilization`);
    }

    return { available: reasons.length === 0, reasons };
}

export function decorateGpus(
    gpus: GpuInfo[],
    settings: AvailabilitySettings
): FleetGpuInfo[] {
    return gpus.map(gpu => ({
        ...gpu,
        availability: evaluateAvailability(gpu, settings)
    }));
}

export function markDuplicateServers(data: ServerStatus[]): ServerStatus[] {
    const physicalHosts = new Map<string, string>();
    return data.map(server => {
        if (server.error || !server.gpus.length) {
            return server;
        }
        const uuids = server.gpus.map(gpu => gpu.uuid).filter(uuid => uuid && uuid !== 'N/A').sort();
        if (uuids.length !== server.gpus.length) {
            return server;
        }
        const key = uuids.join('|');
        const firstHost = physicalHosts.get(key);
        if (!firstHost) {
            physicalHosts.set(key, server.host);
            return server;
        }
        return { ...server, duplicateOf: firstHost };
    });
}

export function uniqueOnlineServers(data: ServerStatus[]): ServerStatus[] {
    return data.filter(server => !server.error && !server.duplicateOf);
}

export function summarizeFleet(data: ServerStatus[], settings: {
    memoryWarningThreshold: number;
    temperatureWarningThreshold: number;
    powerWarningThreshold: number;
}): GpuStatusSummary {
    const online = data.filter(server => !server.error);
    const gpus = uniqueOnlineServers(data).flatMap(server => server.gpus);
    const memoryUsed = gpus.reduce((sum, gpu) => sum + numberValue(gpu.memory.used), 0);
    const memoryTotal = gpus.reduce((sum, gpu) => sum + numberValue(gpu.memory.total), 0);
    const utilization = gpus.reduce((sum, gpu) => sum + numberValue(gpu.utilization.gpu), 0);
    const powerDraw = gpus.reduce((sum, gpu) => sum + numberValue(gpu.power.draw), 0);
    const powerLimit = gpus.reduce((sum, gpu) => sum + numberValue(gpu.power.limit), 0);
    const warnings = gpus.filter(gpu =>
        percent(gpu.memory.used, gpu.memory.total) >= settings.memoryWarningThreshold ||
        numberValue(gpu.temperature.gpu) >= settings.temperatureWarningThreshold ||
        percent(gpu.power.draw, gpu.power.limit) >= settings.powerWarningThreshold
    ).length;

    return {
        serversOnline: online.length,
        serversTotal: data.length,
        gpusAvailable: gpus.filter(gpu => gpu.availability.available).length,
        gpusTotal: gpus.length,
        warnings,
        memoryPercent: memoryTotal > 0 ? Math.round((memoryUsed / memoryTotal) * 100) : 0,
        memoryUsed: Math.round(memoryUsed),
        memoryTotal: Math.round(memoryTotal),
        utilizationPercent: gpus.length ? Math.round(utilization / gpus.length) : 0,
        powerDraw: Math.round(powerDraw),
        powerLimit: Math.round(powerLimit),
        updatedAt: Date.now()
    };
}

export function aggregateUsers(data: ServerStatus[]): UserSummary[] {
    const users = new Map<string, { gpus: Set<string>; processes: Set<string>; memoryMiB: number }>();
    for (const server of uniqueOnlineServers(data)) {
        for (const gpu of server.gpus) {
            for (const process of gpu.processes) {
                const user = process.user || 'unknown';
                const summary = users.get(user) || {
                    gpus: new Set<string>(),
                    processes: new Set<string>(),
                    memoryMiB: 0
                };
                summary.gpus.add(`${server.host}:${gpu.uuid}`);
                summary.processes.add(`${server.host}:${process.pid}`);
                summary.memoryMiB += numberValue(process.usedMemory);
                users.set(user, summary);
            }
        }
    }

    return Array.from(users.entries())
        .map(([user, value]) => ({
            user,
            gpuCount: value.gpus.size,
            processCount: value.processes.size,
            memoryMiB: Math.round(value.memoryMiB)
        }))
        .sort((left, right) => right.memoryMiB - left.memoryMiB || left.user.localeCompare(right.user));
}
