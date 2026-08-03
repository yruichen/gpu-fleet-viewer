import * as vscode from 'vscode';
import { GpuMonitor } from './gpuMonitor';
import { GpuServerProvider } from './serverProvider';
import {
    aggregateUsers,
    decorateGpus,
    FleetGpuInfo,
    GpuStatusSummary,
    markDuplicateServers,
    numberValue,
    ServerErrorCategory,
    ServerMetadata,
    ServerStatus,
    summarizeFleet
} from './fleetModel';
import { getDashboardCss, getDashboardScript, getDashboardTranslation } from './webviewTemplate';

export { GpuStatusSummary } from './fleetModel';

interface ViewSettings {
    compactLayout: boolean;
    showUtilization: boolean;
    showTemperature: boolean;
    showPower: boolean;
    showFanSpeed: boolean;
    showProcesses: boolean;
    showHostHealth: boolean;
    availabilityRequireNoProcesses: boolean;
    availabilityMaxMemoryMiB: number;
    availabilityMaxUtilization: number;
    memoryWarningThreshold: number;
    temperatureWarningThreshold: number;
    powerWarningThreshold: number;
}

type StatusUpdateHandler = (summary: GpuStatusSummary) => void;
type UiLanguage = 'en' | 'zh-CN';
const METADATA_KEY = 'gpu-fleet-viewer.serverMetadata';
const AUTO_REFRESH_KEYS = ['autoRefresh', 'refreshInterval', 'pauseWhenHidden'] as const;
const DATA_REFRESH_KEYS = [
    'sshConfigPath', 'targets', 'additionalHosts', 'ignoredHosts', 'showProcesses',
    'showHostHealth', 'availabilityRequireNoProcesses'
] as const;
const VIEW_ONLY_KEYS = [
    'language', 'compactLayout', 'showUtilization', 'showTemperature', 'showPower',
    'showFanSpeed', 'availabilityMaxMemoryMiB', 'availabilityMaxUtilization',
    'memoryWarningThreshold', 'temperatureWarningThreshold', 'powerWarningThreshold'
] as const;

function getUiLanguage(): UiLanguage {
    const configured = vscode.workspace
        .getConfiguration('gpu-fleet-viewer')
        .get<string>('language', 'auto');
    if (configured === 'zh-CN' || configured === 'en') {
        return configured;
    }
    return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export class GpuViewPanel {
    private static readonly panels = new Set<GpuViewPanel>();
    private static readonly snapshotCache = new Map<string, ServerStatus>();
    private readonly panel: vscode.WebviewPanel;
    private readonly host: string | undefined;
    private readonly monitor = new GpuMonitor();
    private readonly context: vscode.ExtensionContext;
    private readonly onStatusUpdate?: StatusUpdateHandler;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly activeWarnings = new Set<string>();
    private readonly lastSuccessful = new Map<string, ServerStatus>();
    private readonly previousAvailability = new Map<string, boolean>();
    private readonly previousServerOnline = new Map<string, boolean>();
    private readonly duplicateAliases = new Map<string, string>();
    private readonly lastSlurmQueryAt = new Map<string, number>();
    private readonly cachedSlurmByProcess = new Map<string, Map<string, NonNullable<FleetGpuInfo['processes'][number]['slurm']>>>();
    private autoRefreshTimer: NodeJS.Timeout | undefined;
    private refreshPromise: Promise<void> | undefined;
    private refreshQueued = false;
    private disposed = false;
    private lastData: ServerStatus[] = [];
    private lastCompletedAt = 0;
    private lastNotificationAt = 0;

    private constructor(
        panel: vscode.WebviewPanel,
        context: vscode.ExtensionContext,
        host?: string,
        onStatusUpdate?: StatusUpdateHandler
    ) {
        this.panel = panel;
        this.context = context;
        this.host = host;
        this.onStatusUpdate = onStatusUpdate;
        GpuViewPanel.panels.add(this);
        this.panel.webview.html = this.getWebviewContent();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(message => void this.handleMessage(message), null, this.disposables);
        this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
            void this.handleConfigurationChange(event);
        }));
        this.scheduleAutoRefresh();
    }

    public static createOrShow(
        context: vscode.ExtensionContext,
        host?: string,
        onStatusUpdate?: StatusUpdateHandler
    ): void {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
        const existing = Array.from(GpuViewPanel.panels).find(candidate => candidate.host === host);
        if (existing) {
            existing.panel.reveal(column);
            void existing.showCachedAndRefreshIfStale();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'gpuView',
            host ? `GPU: ${host}` : 'GPU Fleet',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')]
            }
        );
        new GpuViewPanel(panel, context, host, onStatusUpdate);
    }

    public static refreshAll(): void {
        for (const panel of GpuViewPanel.panels) {
            void panel.requestRefresh(true);
        }
    }

    public static async showAvailableGpuQuickPick(): Promise<void> {
        const panel = Array.from(GpuViewPanel.panels).find(candidate => !candidate.host && candidate.lastData.length);
        if (!panel) {
            await vscode.window.showInformationMessage('Open GPU Fleet and wait for the first refresh.');
            return;
        }
        const candidates = panel.lastData
            .filter(server => !server.error && !server.duplicateOf)
            .flatMap(server => server.gpus
                .filter(gpu => gpu.availability.available)
                .map(gpu => ({ server, gpu })))
            .sort((left, right) => numberValue(right.gpu.memory.free) - numberValue(left.gpu.memory.free));
        if (!candidates.length) {
            await vscode.window.showInformationMessage('No GPU currently matches your availability rules.');
            return;
        }
        const selected = await vscode.window.showQuickPick(candidates.map(item => ({
            label: `$(server) ${item.server.metadata?.alias || item.server.host} · GPU ${item.gpu.index}`,
            description: item.gpu.name,
            detail: `${item.gpu.memory.free} free · ${item.gpu.utilization.gpu} utilization`,
            item
        })), {
            title: 'Find an available GPU',
            placeHolder: 'Choose a GPU to prepare an SSH research terminal'
        });
        if (selected) {
            panel.openGpuTerminal(selected.item.server.host, selected.item.gpu.uuid);
        }
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        GpuViewPanel.panels.delete(this);
        if (this.autoRefreshTimer) {
            clearTimeout(this.autoRefreshTimer);
        }
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }

    private async handleMessage(message: unknown): Promise<void> {
        if (!message || typeof message !== 'object' || !('command' in message)) {
            return;
        }
        const payload = message as Record<string, unknown>;
        switch (payload.command) {
            case 'refresh':
                await this.requestRefresh(true);
                break;
            case 'ready':
                await this.showCachedAndRefreshIfStale(true);
                break;
            case 'connect':
                if (this.validHost(payload.host)) {
                    await vscode.commands.executeCommand('gpu-fleet-viewer.connectSsh', payload.host);
                }
                break;
            case 'settings':
                await vscode.commands.executeCommand('gpu-fleet-viewer.openSettings');
                break;
            case 'setLanguage':
                if (payload.language === 'en' || payload.language === 'zh-CN') {
                    await vscode.workspace
                        .getConfiguration('gpu-fleet-viewer')
                        .update('language', payload.language, vscode.ConfigurationTarget.Global);
                }
                break;
            case 'copyValue':
                await this.copyRequestedValue(payload);
                break;
            case 'openGpuTerminal':
                if (this.validHost(payload.host) && this.validGpuId(payload.uuid)) {
                    this.openGpuTerminal(String(payload.host), String(payload.uuid));
                }
                break;
            case 'toggleFavorite':
                if (this.validHost(payload.host)) {
                    await this.toggleFavorite(String(payload.host));
                }
                break;
            case 'editServer':
                if (this.validHost(payload.host)) {
                    await this.editServer(String(payload.host));
                }
                break;
        }
    }

    private affectsAny(event: vscode.ConfigurationChangeEvent, keys: readonly string[]): boolean {
        return keys.some(key => event.affectsConfiguration(`gpu-fleet-viewer.${key}`));
    }

    private async handleConfigurationChange(event: vscode.ConfigurationChangeEvent): Promise<void> {
        if (this.affectsAny(event, AUTO_REFRESH_KEYS)) {
            this.scheduleAutoRefresh();
        }
        if (this.affectsAny(event, DATA_REFRESH_KEYS)) {
            await this.requestRefresh(false);
            return;
        }
        if (this.affectsAny(event, VIEW_ONLY_KEYS)) {
            await this.publishCurrent();
        }
    }

    private clearAutoRefreshTimer(): void {
        if (this.autoRefreshTimer) {
            clearTimeout(this.autoRefreshTimer);
            this.autoRefreshTimer = undefined;
        }
    }

    private scheduleAutoRefresh(): void {
        this.clearAutoRefreshTimer();
        if (this.disposed) {
            return;
        }
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        if (!config.get<boolean>('autoRefresh', true)) {
            return;
        }
        const interval = Math.max(2, config.get<number>('refreshInterval', 5));
        this.autoRefreshTimer = setTimeout(() => {
            this.autoRefreshTimer = undefined;
            const latest = vscode.workspace.getConfiguration('gpu-fleet-viewer');
            if (latest.get<boolean>('pauseWhenHidden', true) && !this.panel.visible) {
                this.scheduleAutoRefresh();
                return;
            }
            void this.requestRefresh(false);
        }, interval * 1000);
    }

    private async showCachedAndRefreshIfStale(force = false): Promise<void> {
        await this.publishCurrent();
        const interval = Math.max(2, vscode.workspace
            .getConfiguration('gpu-fleet-viewer')
            .get<number>('refreshInterval', 5)) * 1000;
        if (force || !this.lastCompletedAt || Date.now() - this.lastCompletedAt >= interval) {
            await this.requestRefresh(false);
        }
    }

    private async requestRefresh(queueIfBusy: boolean): Promise<void> {
        if (this.disposed) {
            return;
        }
        if (this.refreshPromise) {
            if (queueIfBusy) {
                this.refreshQueued = true;
                await this.panel.webview.postMessage({
                    type: 'refreshState',
                    state: 'queued',
                    language: getUiLanguage()
                });
            }
            return this.refreshPromise;
        }

        this.clearAutoRefreshTimer();
        const run = async () => {
            do {
                this.refreshQueued = false;
                await this.refreshOnce();
            } while (this.refreshQueued && !this.disposed);
        };
        const promise = run().finally(() => {
            if (this.refreshPromise === promise) {
                this.refreshPromise = undefined;
            }
            this.scheduleAutoRefresh();
        });
        this.refreshPromise = promise;
        await promise;
    }

    private async refreshOnce(): Promise<void> {
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        const settings = this.readViewSettings();
        const hosts = this.host ? [{ host: this.host }] : GpuServerProvider.getHosts();
        const hostNames = hosts.map(item => item.host);
        const maxConcurrent = Math.max(1, Math.min(32, config.get<number>('maxConcurrentHosts', 8)));
        const metadata = this.context.globalState.get<Record<string, ServerMetadata>>(METADATA_KEY, {});
        const queryHosts = hostNames.filter(host => {
            const primary = this.duplicateAliases.get(host);
            return !primary || !hostNames.includes(primary);
        });
        const results = new Map<string, ServerStatus>();
        const current = new Map(this.lastData.map(server => [server.host, server]));
        for (const host of hostNames) {
            const cached = current.get(host) || GpuViewPanel.snapshotCache.get(host);
            if (cached) {
                results.set(host, cached);
            }
        }

        const total = queryHosts.length;
        if (results.size) {
            await this.publishResults(results, hostNames, metadata, settings, true, 0, total, false);
        } else {
            await this.panel.webview.postMessage({
                type: 'refreshState', state: 'refreshing', completed: 0, total, language: getUiLanguage()
            });
        }

        let lastPublishedAt = 0;
        await this.mapWithConcurrency(
            queryHosts,
            maxConcurrent,
            host => this.queryHost(host, config, settings, metadata),
            async (status, _index, completed) => {
                results.set(status.host, status);
                const now = Date.now();
                if (completed === 1 || completed === total || now - lastPublishedAt >= 120) {
                    lastPublishedAt = now;
                    await this.publishResults(results, hostNames, metadata, settings, true, completed, total, false);
                } else {
                    await this.panel.webview.postMessage({
                        type: 'refreshState', state: 'refreshing', completed, total, language: getUiLanguage()
                    });
                }
            }
        );

        this.lastCompletedAt = Date.now();
        await this.publishResults(results, hostNames, metadata, settings, false, total, total, true);
    }

    private async queryHost(
        host: string,
        config: vscode.WorkspaceConfiguration,
        settings: ViewSettings,
        metadata: Record<string, ServerMetadata>
    ): Promise<ServerStatus> {
        const startedAt = Date.now();
        const timeoutSeconds = config.get<number>('sshTimeout', 8);
        try {
            const slurmEnabled = config.get<boolean>('enableSlurmIntegration', true);
            const slurmInterval = Math.max(5, config.get<number>('slurmRefreshInterval', 30)) * 1000;
            const shouldQuerySlurm = slurmEnabled && settings.showProcesses &&
                Date.now() - (this.lastSlurmQueryAt.get(host) || 0) >= slurmInterval;
            const snapshot = await this.monitor.getServerSnapshot(host, {
                timeoutSeconds,
                includeProcessOwners: settings.showProcesses,
                includeProcesses: settings.showProcesses || settings.availabilityRequireNoProcesses,
                includeHostHealth: settings.showHostHealth,
                includeSlurm: shouldQuerySlurm
            });
            if (shouldQuerySlurm) {
                this.lastSlurmQueryAt.set(host, Date.now());
                if (snapshot.slurmAvailable) {
                    const jobs = new Map<string, NonNullable<FleetGpuInfo['processes'][number]['slurm']>>();
                    snapshot.gpus.flatMap(gpu => gpu.processes).forEach(process => {
                        if (process.slurm) jobs.set(process.pid, process.slurm);
                    });
                    this.cachedSlurmByProcess.set(host, jobs);
                } else {
                    this.cachedSlurmByProcess.delete(host);
                }
            } else {
                const jobs = this.cachedSlurmByProcess.get(host);
                if (jobs) {
                    snapshot.gpus.flatMap(gpu => gpu.processes).forEach(process => {
                        process.slurm = jobs.get(process.pid);
                    });
                }
            }
            const status: ServerStatus = {
                host,
                gpus: decorateGpus(snapshot.gpus, settings),
                health: snapshot.health,
                collectedAt: snapshot.collectedAt,
                latencyMs: snapshot.latencyMs,
                lastSuccessAt: snapshot.collectedAt,
                stale: false,
                metadata: metadata[host],
                slurmAvailable: snapshot.slurmAvailable || this.cachedSlurmByProcess.has(host),
                healthAvailable: snapshot.healthAvailable
            };
            this.lastSuccessful.set(host, status);
            GpuViewPanel.snapshotCache.set(host, status);
            return status;
        } catch (error) {
            const friendly = this.friendlyError(error);
            const previous = this.lastSuccessful.get(host) || GpuViewPanel.snapshotCache.get(host);
            return {
                host,
                gpus: previous?.gpus || [],
                health: previous?.health,
                collectedAt: Date.now(),
                latencyMs: Date.now() - startedAt,
                lastSuccessAt: previous?.lastSuccessAt,
                stale: Boolean(previous),
                metadata: metadata[host],
                slurmAvailable: previous?.slurmAvailable,
                healthAvailable: Boolean(previous?.health),
                error: friendly.message,
                errorCategory: friendly.category
            };
        }
    }

    private composeData(
        results: Map<string, ServerStatus>,
        hostNames: string[],
        metadata: Record<string, ServerMetadata>,
        settings: ViewSettings
    ): ServerStatus[] {
        const collected: ServerStatus[] = [];
        for (const host of hostNames) {
            const primaryHost = this.duplicateAliases.get(host);
            const status = primaryHost && hostNames.includes(primaryHost)
                ? results.get(primaryHost) || results.get(host)
                : results.get(host);
            if (!status) {
                continue;
            }
            collected.push({
                ...status,
                host,
                gpus: decorateGpus(status.gpus, settings),
                metadata: metadata[host],
                duplicateOf: primaryHost && primaryHost !== host ? primaryHost : status.duplicateOf
            });
        }
        const data = markDuplicateServers(collected).sort((left, right) => {
            const favorite = Number(Boolean(right.metadata?.favorite)) - Number(Boolean(left.metadata?.favorite));
            return favorite || (left.metadata?.group || '').localeCompare(right.metadata?.group || '');
        });
        for (const server of data) {
            if (server.duplicateOf) {
                this.duplicateAliases.set(server.host, server.duplicateOf);
            }
        }
        return data;
    }

    private async publishResults(
        results: Map<string, ServerStatus>,
        hostNames: string[],
        metadata: Record<string, ServerMetadata>,
        settings: ViewSettings,
        refreshing: boolean,
        completed: number,
        total: number,
        notify: boolean
    ): Promise<void> {
        this.lastData = this.composeData(results, hostNames, metadata, settings);
        await this.postUpdate(settings, refreshing, completed, total, notify);
    }

    private async publishCurrent(): Promise<void> {
        const settings = this.readViewSettings();
        const hostNames = (this.host ? [{ host: this.host }] : GpuServerProvider.getHosts()).map(item => item.host);
        const metadata = this.context.globalState.get<Record<string, ServerMetadata>>(METADATA_KEY, {});
        const results = new Map(this.lastData.map(server => [server.host, server]));
        for (const host of hostNames) {
            const cached = GpuViewPanel.snapshotCache.get(host);
            if (!results.has(host) && cached) {
                results.set(host, cached);
            }
        }
        if (!results.size) {
            return;
        }
        this.lastData = this.composeData(results, hostNames, metadata, settings);
        await this.postUpdate(settings, Boolean(this.refreshPromise), 0, hostNames.length, false);
    }

    private async postUpdate(
        settings: ViewSettings,
        refreshing: boolean,
        completed: number,
        total: number,
        notify: boolean
    ): Promise<void> {
        const summary = summarizeFleet(this.lastData, settings);
        const language = getUiLanguage();
        this.onStatusUpdate?.(summary);
        if (notify) {
            this.notifyTransitions(this.lastData, settings);
        }
        this.panel.title = this.host ? `GPU: ${this.host}` : getDashboardTranslation(language, 'panelTitle');
        await this.panel.webview.postMessage({
            type: 'update',
            title: this.host ? `GPU: ${this.host}` : getDashboardTranslation(language, 'dashboardTitle'),
            language,
            data: this.lastData,
            users: settings.showProcesses ? aggregateUsers(this.lastData) : [],
            settings,
            summary,
            refresh: { active: refreshing, completed, total }
        });
    }

    private readViewSettings(): ViewSettings {
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        return {
            compactLayout: config.get<boolean>('compactLayout', true),
            showUtilization: config.get<boolean>('showUtilization', true),
            showTemperature: config.get<boolean>('showTemperature', true),
            showPower: config.get<boolean>('showPower', true),
            showFanSpeed: config.get<boolean>('showFanSpeed', true),
            showProcesses: config.get<boolean>('showProcesses', true),
            showHostHealth: config.get<boolean>('showHostHealth', true),
            availabilityRequireNoProcesses: config.get<boolean>('availabilityRequireNoProcesses', true),
            availabilityMaxMemoryMiB: config.get<number>('availabilityMaxMemoryMiB', 512),
            availabilityMaxUtilization: config.get<number>('availabilityMaxUtilization', 10),
            memoryWarningThreshold: config.get<number>('memoryWarningThreshold', 85),
            temperatureWarningThreshold: config.get<number>('temperatureWarningThreshold', 80),
            powerWarningThreshold: config.get<number>('powerWarningThreshold', 90)
        };
    }

    private notifyTransitions(data: ServerStatus[], settings: ViewSettings): void {
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        const enabled = config.get<boolean>('enableNotifications', false);
        const eventTypes = new Set(config.get<string[]>('notificationEvents', ['serverState', 'gpuAvailable', 'threshold']));
        const messages: string[] = [];
        const currentWarnings = new Set<string>();

        for (const server of data) {
            const online = !server.error;
            const previousOnline = this.previousServerOnline.get(server.host);
            if (previousOnline !== undefined && previousOnline !== online && eventTypes.has('serverState')) {
                messages.push(`${server.host} is ${online ? 'online' : 'offline'}`);
            }
            this.previousServerOnline.set(server.host, online);

            for (const gpu of server.gpus) {
                const key = `${server.host}:${gpu.uuid}`;
                const previousAvailable = this.previousAvailability.get(key);
                if (previousAvailable === false && gpu.availability.available && eventTypes.has('gpuAvailable')) {
                    messages.push(`${server.host} GPU ${gpu.index} is now available`);
                }
                this.previousAvailability.set(key, gpu.availability.available);

                const memory = numberValue(gpu.memory.used) / Math.max(1, numberValue(gpu.memory.total)) * 100;
                const temperature = numberValue(gpu.temperature.gpu);
                const power = numberValue(gpu.power.draw) / Math.max(1, numberValue(gpu.power.limit)) * 100;
                if (memory >= settings.memoryWarningThreshold ||
                    temperature >= settings.temperatureWarningThreshold ||
                    power >= settings.powerWarningThreshold) {
                    currentWarnings.add(key);
                    if (!this.activeWarnings.has(key) && eventTypes.has('threshold')) {
                        messages.push(`${server.host} GPU ${gpu.index} crossed a warning threshold`);
                    }
                }
            }
        }
        this.activeWarnings.clear();
        currentWarnings.forEach(key => this.activeWarnings.add(key));

        const cooldown = Math.max(0, config.get<number>('notificationCooldownSeconds', 60)) * 1000;
        if (enabled && messages.length && Date.now() - this.lastNotificationAt >= cooldown) {
            this.lastNotificationAt = Date.now();
            void vscode.window.showWarningMessage(`GPU Fleet — ${messages.slice(0, 4).join(' · ')}`);
        }
    }

    private openGpuTerminal(host: string, uuid: string): void {
        if (!this.validHost(host) || !this.validGpuId(uuid)) {
            return;
        }
        const terminal = vscode.window.createTerminal({ name: `GPU ${host}` });
        terminal.show();
        const command = `ssh -t ${host} 'export CUDA_DEVICE_ORDER=PCI_BUS_ID; export CUDA_VISIBLE_DEVICES=${uuid}; exec "$SHELL" -l'`;
        terminal.sendText(command, false);
    }

    private async copyRequestedValue(payload: Record<string, unknown>): Promise<void> {
        const host = String(payload.host || '');
        const uuid = String(payload.uuid || '');
        const pid = String(payload.pid || '');
        if (!this.validHost(host)) {
            return;
        }
        const server = this.lastData.find(item => item.host === host);
        const gpu = server?.gpus.find(item => item.uuid === uuid);
        const process = gpu?.processes.find(item => item.pid === pid);
        let value = '';
        switch (payload.kind) {
            case 'ssh': value = `ssh ${host}`; break;
            case 'cuda':
                if (gpu) value = `export CUDA_DEVICE_ORDER=PCI_BUS_ID\nexport CUDA_VISIBLE_DEVICES=${gpu.uuid}`;
                break;
            case 'pid': if (process) value = process.pid; break;
            case 'command': if (process) value = process.command; break;
        }
        if (value) {
            await vscode.env.clipboard.writeText(value);
            await vscode.window.showInformationMessage('Copied to clipboard.');
        }
    }

    private async toggleFavorite(host: string): Promise<void> {
        const metadata = this.context.globalState.get<Record<string, ServerMetadata>>(METADATA_KEY, {});
        metadata[host] = { ...metadata[host], favorite: !metadata[host]?.favorite };
        await this.context.globalState.update(METADATA_KEY, metadata);
        await this.publishCurrent();
    }

    private async editServer(host: string): Promise<void> {
        const metadata = this.context.globalState.get<Record<string, ServerMetadata>>(METADATA_KEY, {});
        const alias = await vscode.window.showInputBox({
            title: `Display name for ${host}`,
            value: metadata[host]?.alias || '',
            placeHolder: 'Optional server alias'
        });
        if (alias === undefined) {
            return;
        }
        const group = await vscode.window.showInputBox({
            title: `Group for ${host}`,
            value: metadata[host]?.group || '',
            placeHolder: 'e.g. Lab A, A6000, Personal'
        });
        if (group === undefined) {
            return;
        }
        metadata[host] = {
            ...metadata[host],
            alias: alias.trim() || undefined,
            group: group.trim() || undefined
        };
        await this.context.globalState.update(METADATA_KEY, metadata);
        await this.publishCurrent();
    }

    private friendlyError(error: unknown): { message: string; category: ServerErrorCategory } {
        const message = error instanceof Error ? error.message : String(error);
        if (/timed out|ETIMEDOUT/i.test(message)) {
            return {
                message: 'GPU snapshot timed out. The server may be overloaded or nvidia-smi may be unresponsive.',
                category: 'timeout'
            };
        }
        if (/Permission denied/i.test(message)) {
            return { message: 'SSH authentication failed. Configure key-based login.', category: 'authentication' };
        }
        if (/Could not resolve hostname/i.test(message)) {
            return { message: 'Host not found. Check the SSH alias or address.', category: 'host-not-found' };
        }
        if (/No route to host|Connection refused|Network is unreachable/i.test(message)) {
            return { message: 'Server is unreachable. Check its network and SSH service.', category: 'unreachable' };
        }
        if (/nvidia-smi.*not found|command not found/i.test(message)) {
            return { message: 'nvidia-smi is not available on this server.', category: 'nvidia-smi' };
        }
        return { message: message.trim() || 'Unable to load GPU status.', category: 'unknown' };
    }

    private validHost(value: unknown): boolean {
        return typeof value === 'string' && !value.startsWith('-') && /^[A-Za-z0-9_.:@-]+$/.test(value);
    }

    private validGpuId(value: unknown): boolean {
        return typeof value === 'string' && /^[A-Za-z0-9_.:-]+$/.test(value);
    }

    private async mapWithConcurrency<T, R>(
        values: T[],
        concurrency: number,
        mapper: (value: T) => Promise<R>,
        onResult?: (result: R, index: number, completed: number) => Promise<void> | void
    ): Promise<R[]> {
        const results = new Array<R>(values.length);
        let nextIndex = 0;
        let completed = 0;
        const worker = async () => {
            while (nextIndex < values.length) {
                const index = nextIndex++;
                results[index] = await mapper(values[index]);
                completed += 1;
                await onResult?.(results[index], index, completed);
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
        return results;
    }

    private getWebviewContent(): string {
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <title>GPU Fleet Viewer</title>
            <style>${getDashboardCss()}</style>
        </head>
        <body>
            <header class="toolbar">
                <div><h1 id="page-title"></h1><span id="refresh-state" class="subtle"></span></div>
                <div class="toolbar-actions">
                    <button id="language-button" class="secondary-button"></button>
                    <button id="settings-button" class="secondary-button"></button>
                    <button id="refresh-button"></button>
                </div>
            </header>
            <section id="summary" class="summary-strip" aria-label="GPU summary"></section>
            <section class="fleet-controls" aria-label="Fleet filters">
                <input id="search-input" type="search" placeholder="Search servers, GPUs, users, commands, or Slurm jobs">
                <select id="status-filter" aria-label="Status filter">
                    <option value="all"></option><option value="available"></option>
                    <option value="busy"></option><option value="warning"></option><option value="offline"></option>
                </select>
                <select id="sort-select" aria-label="Sort GPUs">
                    <option value="configured"></option><option value="freeMemory"></option>
                    <option value="utilization"></option><option value="temperature"></option>
                </select>
            </section>
            <section id="user-filters" class="user-filters" aria-label="Active users"></section>
            <main id="content" aria-live="polite"><div class="empty-state"></div></main>
            <script nonce="${nonce}">${getDashboardScript()}</script>
        </body>
        </html>`;
    }

    private getNonce(): string {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let text = '';
        for (let index = 0; index < 32; index += 1) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
