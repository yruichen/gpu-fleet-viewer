import * as vscode from 'vscode';
import { GpuMonitor, GpuInfo } from './gpuMonitor';
import { GpuServerProvider } from './serverProvider';
import { getDashboardCss, getDashboardScript } from './webviewTemplate';

interface ServerStatus {
    host: string;
    gpus: GpuInfo[];
    error?: string;
}

interface ViewSettings {
    compactLayout: boolean;
    showUtilization: boolean;
    showTemperature: boolean;
    showPower: boolean;
    showFanSpeed: boolean;
    showProcesses: boolean;
    memoryWarningThreshold: number;
    temperatureWarningThreshold: number;
    powerWarningThreshold: number;
}

export interface GpuStatusSummary {
    serversOnline: number;
    serversTotal: number;
    gpusAvailable: number;
    gpusTotal: number;
    memoryPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    utilizationPercent: number;
    powerDraw: number;
    updatedAt: number;
}

type StatusUpdateHandler = (summary: GpuStatusSummary) => void;

export class GpuViewPanel {
    private static readonly _panels = new Set<GpuViewPanel>();
    private readonly _panel: vscode.WebviewPanel;
    private readonly _host: string | undefined;
    private readonly _monitor = new GpuMonitor();
    private readonly _onStatusUpdate?: StatusUpdateHandler;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _activeWarnings = new Set<string>();
    private _timer: NodeJS.Timeout | undefined;
    private _isUpdating = false;
    private _disposed = false;

    private constructor(
        panel: vscode.WebviewPanel,
        host: string | undefined,
        onStatusUpdate?: StatusUpdateHandler
    ) {
        this._panel = panel;
        this._host = host;
        this._onStatusUpdate = onStatusUpdate;
        GpuViewPanel._panels.add(this);
        this._panel.webview.html = this._getWebviewContent();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'refresh':
                        void this._update();
                        break;
                    case 'connect':
                        void vscode.commands.executeCommand('gpu-fleet-viewer.connectSsh', message.host);
                        break;
                    case 'settings':
                        void vscode.commands.executeCommand('gpu-fleet-viewer.openSettings');
                        break;
                    case 'ready':
                        void this._update();
                        break;
                }
            },
            null,
            this._disposables
        );

        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('gpu-fleet-viewer')) {
                    this._setupAutoRefresh();
                    void this._update();
                }
            })
        );

        this._setupAutoRefresh();
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        host?: string,
        onStatusUpdate?: StatusUpdateHandler
    ): void {
        const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
        const title = host ? `GPU: ${host}` : 'GPU Fleet';
        const panel = vscode.window.createWebviewPanel(
            'gpuView',
            title,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        new GpuViewPanel(panel, host, onStatusUpdate);
    }

    public static refreshAll(): void {
        for (const panel of GpuViewPanel._panels) {
            void panel._update();
        }
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        GpuViewPanel._panels.delete(this);

        if (this._timer) {
            clearInterval(this._timer);
        }

        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }

    private _setupAutoRefresh(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }

        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        const autoRefresh = config.get<boolean>('autoRefresh', true);
        const interval = Math.max(2, config.get<number>('refreshInterval', 5));

        if (autoRefresh) {
            this._timer = setInterval(() => void this._update(), interval * 1000);
        }
    }

    private async _update(): Promise<void> {
        if (this._isUpdating || this._disposed) {
            return;
        }

        this._isUpdating = true;
        await this._panel.webview.postMessage({ type: 'loading' });

        try {
            const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
            const timeoutSeconds = config.get<number>('sshTimeout', 8);
            const includeProcessOwners = config.get<boolean>('showProcesses', true);
            const hosts = this._host
                ? [{ host: this._host }]
                : GpuServerProvider.getHosts();

            const data = await Promise.all(hosts.map(async host => {
                try {
                    const gpus = await this._monitor.getGpuStatus(host.host, {
                        timeoutSeconds,
                        includeProcessOwners
                    });
                    return { host: host.host, gpus } as ServerStatus;
                } catch (error) {
                    return {
                        host: host.host,
                        gpus: [],
                        error: this._friendlyError(error)
                    } as ServerStatus;
                }
            }));

            const settings = this._readViewSettings();
            const summary = this._summarize(data);
            this._onStatusUpdate?.(summary);
            this._notifyWarnings(data, settings);

            await this._panel.webview.postMessage({
                type: 'update',
                title: this._host ? `GPU: ${this._host}` : 'Fleet Summary',
                data,
                settings,
                summary
            });
        } finally {
            this._isUpdating = false;
        }
    }

    private _readViewSettings(): ViewSettings {
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        return {
            compactLayout: config.get<boolean>('compactLayout', true),
            showUtilization: config.get<boolean>('showUtilization', true),
            showTemperature: config.get<boolean>('showTemperature', true),
            showPower: config.get<boolean>('showPower', true),
            showFanSpeed: config.get<boolean>('showFanSpeed', true),
            showProcesses: config.get<boolean>('showProcesses', true),
            memoryWarningThreshold: config.get<number>('memoryWarningThreshold', 85),
            temperatureWarningThreshold: config.get<number>('temperatureWarningThreshold', 80),
            powerWarningThreshold: config.get<number>('powerWarningThreshold', 90)
        };
    }

    private _summarize(data: ServerStatus[]): GpuStatusSummary {
        const online = data.filter(server => !server.error);
        const gpus = online.flatMap(server => server.gpus);
        const used = gpus.reduce((sum, gpu) => sum + this._number(gpu.memory.used), 0);
        const total = gpus.reduce((sum, gpu) => sum + this._number(gpu.memory.total), 0);
        const utilization = gpus.reduce((sum, gpu) => sum + this._number(gpu.utilization.gpu), 0);
        const powerDraw = gpus.reduce((sum, gpu) => sum + this._number(gpu.power.draw), 0);
        const available = gpus.filter(gpu => {
            const memoryPercent = this._percent(gpu.memory.used, gpu.memory.total);
            return memoryPercent < 10 && this._number(gpu.utilization.gpu) < 10;
        }).length;

        return {
            serversOnline: online.length,
            serversTotal: data.length,
            gpusAvailable: available,
            gpusTotal: gpus.length,
            memoryPercent: total > 0 ? Math.round((used / total) * 100) : 0,
            memoryUsed: Math.round(used),
            memoryTotal: Math.round(total),
            utilizationPercent: gpus.length ? Math.round(utilization / gpus.length) : 0,
            powerDraw: Math.round(powerDraw),
            updatedAt: Date.now()
        };
    }

    private _notifyWarnings(data: ServerStatus[], settings: ViewSettings): void {
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        const notificationsEnabled = config.get<boolean>('enableNotifications', false);
        const currentWarnings = new Set<string>();
        const newWarnings: string[] = [];

        for (const server of data) {
            for (const gpu of server.gpus) {
                const memory = this._percent(gpu.memory.used, gpu.memory.total);
                const temperature = this._number(gpu.temperature.gpu);
                const power = this._percent(gpu.power.draw, gpu.power.limit);
                const reasons: string[] = [];

                if (memory >= settings.memoryWarningThreshold) {
                    reasons.push(`memory ${Math.round(memory)}%`);
                }
                if (temperature >= settings.temperatureWarningThreshold) {
                    reasons.push(`temperature ${Math.round(temperature)}°C`);
                }
                if (power >= settings.powerWarningThreshold) {
                    reasons.push(`power ${Math.round(power)}%`);
                }

                if (reasons.length) {
                    const key = `${server.host}:${gpu.index}`;
                    currentWarnings.add(key);
                    if (!this._activeWarnings.has(key)) {
                        newWarnings.push(`${server.host} GPU ${gpu.index}: ${reasons.join(', ')}`);
                    }
                }
            }
        }

        this._activeWarnings.clear();
        currentWarnings.forEach(key => this._activeWarnings.add(key));

        if (notificationsEnabled && newWarnings.length) {
            void vscode.window.showWarningMessage(`GPU warning — ${newWarnings.join(' · ')}`);
        }
    }

    private _friendlyError(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        if (/timed out|ETIMEDOUT/i.test(message)) {
            return 'Connection timed out. Check the host, VPN, and SSH settings.';
        }
        if (/Permission denied/i.test(message)) {
            return 'SSH authentication failed. Configure key-based login for this host.';
        }
        if (/Could not resolve hostname/i.test(message)) {
            return 'Host not found. Check your SSH config alias or address.';
        }
        if (/nvidia-smi.*not found|command not found/i.test(message)) {
            return 'nvidia-smi is not available on this server.';
        }
        return message.trim() || 'Unable to load GPU status.';
    }

    private _number(value: string): number {
        const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : 0;
    }

    private _percent(value: string, total: string): number {
        const denominator = this._number(total);
        return denominator > 0 ? (this._number(value) / denominator) * 100 : 0;
    }

    private _getWebviewContent(): string {
        const nonce = this._getNonce();
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
                <h1 id="page-title">Fleet Summary</h1>
                <div class="toolbar-actions">
                    <span id="refresh-state" class="subtle">Waiting for GPU data…</span>
                    <button id="settings-button" class="secondary-button">Settings</button>
                    <button id="refresh-button">Refresh</button>
                </div>
            </header>
            <section id="summary" class="summary-strip" aria-label="GPU summary"></section>
            <main id="content" aria-live="polite">
                <div class="empty-state">Loading servers…</div>
            </main>
            <script nonce="${nonce}">${getDashboardScript()}</script>
        </body>
        </html>`;
    }

    private _getScript(): string {
        return `
            const vscode = acquireVsCodeApi();
            const content = document.getElementById('content');
            const summaryRoot = document.getElementById('summary');
            const refreshState = document.getElementById('refresh-state');
            const pageTitle = document.getElementById('page-title');

            document.getElementById('refresh-button').addEventListener('click', () => {
                vscode.postMessage({ command: 'refresh' });
            });
            document.getElementById('settings-button').addEventListener('click', () => {
                vscode.postMessage({ command: 'settings' });
            });

            function node(tag, className, text) {
                const element = document.createElement(tag);
                if (className) element.className = className;
                if (text !== undefined) element.textContent = text;
                return element;
            }

            function number(value) {
                const parsed = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
                return Number.isFinite(parsed) ? parsed : 0;
            }

            function percent(value, total) {
                const maximum = number(total);
                return maximum > 0 ? (number(value) / maximum) * 100 : 0;
            }

            function shortProcessName(value) {
                const parts = String(value).split(/[\\/]/);
                return parts[parts.length - 1] || value;
            }

            function addMetric(root, label, value, warning) {
                if (!value || value === 'N/A') return;
                const metric = node('div', warning ? 'metric warning' : 'metric');
                metric.append(node('span', 'metric-label', label), node('strong', '', value));
                root.append(metric);
            }

            function renderSummary(summary) {
                summaryRoot.replaceChildren();
                const items = [
                    ['Servers', summary.serversOnline + ' / ' + summary.serversTotal + ' online'],
                    ['GPUs', String(summary.gpusTotal)],
                    ['Available', String(summary.gpusAvailable)],
                    ['Memory', summary.memoryPercent + '% used']
                ];
                for (const [label, value] of items) {
                    const item = node('div', 'summary-item');
                    item.append(node('span', 'summary-label', label), node('strong', 'summary-value', value));
                    summaryRoot.append(item);
                }
            }

            function renderGpu(host, gpu, settings, openDetails) {
                const memoryPercent = Math.min(100, percent(gpu.memory.used, gpu.memory.total));
                const temperature = number(gpu.temperature.gpu);
                const powerPercent = percent(gpu.power.draw, gpu.power.limit);
                const hasWarning = memoryPercent >= settings.memoryWarningThreshold ||
                    temperature >= settings.temperatureWarningThreshold ||
                    powerPercent >= settings.powerWarningThreshold;
                const card = node('article', hasWarning ? 'gpu-card has-warning' : 'gpu-card');

                const heading = node('div', 'gpu-heading');
                const nameWrap = node('div', 'gpu-name-wrap');
                nameWrap.append(node('span', 'gpu-index', 'GPU ' + gpu.index), node('h3', '', gpu.name));
                const usage = settings.showUtilization ? gpu.utilization.gpu : '';
                if (usage && usage !== 'N/A') heading.append(nameWrap, node('strong', 'utilization', usage));
                else heading.append(nameWrap);
                card.append(heading);

                const memoryHeader = node('div', 'memory-header');
                memoryHeader.append(
                    node('span', '', 'Memory'),
                    node('span', memoryPercent >= settings.memoryWarningThreshold ? 'warning-text' : '', gpu.memory.used + ' / ' + gpu.memory.total)
                );
                const track = node('div', 'progress-track');
                track.setAttribute('role', 'progressbar');
                track.setAttribute('aria-valuenow', String(Math.round(memoryPercent)));
                track.setAttribute('aria-valuemin', '0');
                track.setAttribute('aria-valuemax', '100');
                const fill = node('div', memoryPercent >= settings.memoryWarningThreshold ? 'progress-fill warning-fill' : 'progress-fill');
                fill.style.width = memoryPercent + '%';
                track.append(fill);
                card.append(memoryHeader, track);

                const metrics = node('div', 'metrics');
                if (settings.showTemperature) {
                    addMetric(metrics, 'Temp', gpu.temperature.gpu, temperature >= settings.temperatureWarningThreshold);
                }
                if (settings.showPower) {
                    const power = gpu.power.draw !== 'N/A'
                        ? gpu.power.draw + (gpu.power.limit !== 'N/A' ? ' / ' + gpu.power.limit : '')
                        : 'N/A';
                    addMetric(metrics, 'Power', power, powerPercent >= settings.powerWarningThreshold);
                }
                if (settings.showFanSpeed) {
                    addMetric(metrics, 'Fan', gpu.fanSpeed, false);
                }
                if (metrics.childElementCount) card.append(metrics);

                if (settings.showProcesses) {
                    const detailsKey = host + ':' + gpu.index;
                    const details = node('details', 'processes');
                    details.dataset.key = detailsKey;
                    details.open = openDetails.has(detailsKey);
                    const processCount = gpu.processes.length;
                    details.append(node('summary', '', processCount + (processCount === 1 ? ' process' : ' processes')));
                    const list = node('div', 'process-list');
                    if (!processCount) {
                        list.append(node('div', 'no-processes', 'No active GPU processes'));
                    } else {
                        for (const process of gpu.processes) {
                            const row = node('div', 'process-row');
                            const identity = node('div', 'process-identity');
                            const processName = node('strong', 'process-name', shortProcessName(process.name));
                            processName.title = process.name;
                            identity.append(processName, node('span', 'subtle', process.user + ' · PID ' + process.pid));
                            row.append(identity, node('span', 'process-memory', process.usedMemory));
                            list.append(row);
                        }
                    }
                    details.append(list);
                    card.append(details);
                }

                return card;
            }

            function renderServer(server, settings, openDetails) {
                const classes = ['server-card'];
                if (!server.error) classes.push('online');
                if (settings.compactLayout && server.gpus.length >= 5) classes.push('server-card-wide');
                const card = node('section', classes.join(' '));

                const header = node('header', 'server-header');
                const identity = node('div', 'server-identity');
                identity.append(
                    node('h2', '', server.host),
                    node('span', 'subtle', server.error ? 'Offline' : server.gpus.length + (server.gpus.length === 1 ? ' GPU' : ' GPUs'))
                );
                const connect = node('button', 'secondary-button', 'Connect');
                connect.addEventListener('click', () => vscode.postMessage({ command: 'connect', host: server.host }));
                header.append(identity, connect);
                card.append(header);

                if (server.error) {
                    const error = node('div', 'error-state', server.error);
                    error.title = server.error;
                    card.append(error);
                    return card;
                }

                if (!server.gpus.length) {
                    card.append(node('div', 'empty-state compact-empty', 'No NVIDIA GPUs found'));
                    return card;
                }

                const grid = node('div', settings.compactLayout ? 'gpu-grid compact' : 'gpu-grid');
                for (const gpu of server.gpus) grid.append(renderGpu(server.host, gpu, settings, openDetails));
                card.append(grid);
                return card;
            }

            function render(message) {
                const openDetails = new Set(
                    Array.from(document.querySelectorAll('details[data-key][open]')).map(item => item.dataset.key)
                );
                pageTitle.textContent = message.title;
                refreshState.textContent = 'Updated ' + new Date(message.summary.updatedAt).toLocaleTimeString();
                renderSummary(message.summary);
                content.replaceChildren();

                if (!message.data.length) {
                    content.append(node('div', 'empty-state', 'No servers found. Add an SSH target or check extension settings.'));
                    return;
                }

                const grid = node('div', 'dashboard-grid');
                for (const server of message.data) grid.append(renderServer(server, message.settings, openDetails));
                content.append(grid);
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.type === 'loading') {
                    refreshState.textContent = 'Refreshing…';
                    document.getElementById('refresh-button').disabled = true;
                    return;
                }
                if (message.type === 'update') {
                    document.getElementById('refresh-button').disabled = false;
                    render(message);
                }
            });

            vscode.postMessage({ command: 'ready' });
        `;
    }

    private _getCss(): string {
        return `
            :root { color-scheme: light dark; }
            * { box-sizing: border-box; }
            body {
                margin: 0;
                padding: 18px;
                color: var(--vscode-foreground);
                background: var(--vscode-editor-background);
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
            }
            button {
                min-height: 28px;
                padding: 4px 12px;
                border: 1px solid transparent;
                border-radius: 4px;
                color: var(--vscode-button-foreground);
                background: var(--vscode-button-background);
                font: inherit;
                cursor: pointer;
            }
            button:hover { background: var(--vscode-button-hoverBackground); }
            button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
            button:disabled { cursor: wait; opacity: .65; }
            .secondary-button {
                color: var(--vscode-button-secondaryForeground);
                background: var(--vscode-button-secondaryBackground);
            }
            .secondary-button:hover { background: var(--vscode-button-secondaryHoverBackground); }
            .toolbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                margin-bottom: 14px;
            }
            .toolbar h1 { margin: 0 0 3px; font-size: 19px; line-height: 1.25; }
            .toolbar-actions { display: flex; gap: 8px; }
            .subtle { color: var(--vscode-descriptionForeground); font-size: 12px; }
            .summary-strip {
                display: grid;
                grid-template-columns: repeat(4, minmax(110px, 1fr));
                gap: 1px;
                margin-bottom: 12px;
                overflow: hidden;
                border: 1px solid var(--vscode-widget-border);
                border-radius: 7px;
                background: var(--vscode-widget-border);
            }
            .summary-item {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 8px;
                min-width: 0;
                padding: 9px 12px;
                background: var(--vscode-sideBar-background);
            }
            .summary-label { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
            .summary-value { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
            .dashboard-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(min(100%, 500px), 1fr));
                gap: 12px;
                align-items: start;
            }
            .server-card {
                min-width: 0;
                padding: 12px;
                border: 1px solid var(--vscode-widget-border);
                border-left: 3px solid var(--vscode-errorForeground);
                border-radius: 7px;
                background: var(--vscode-sideBar-background);
            }
            .server-card.online { border-left-color: var(--vscode-testing-iconPassed); }
            .server-card-wide { grid-column: 1 / -1; }
            .server-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 10px;
            }
            .server-identity { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
            .server-identity h2 { overflow: hidden; margin: 0; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
            .gpu-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
            .gpu-grid.compact { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
            .gpu-card {
                min-width: 0;
                padding: 10px;
                border: 1px solid var(--vscode-widget-border);
                border-radius: 5px;
                background: var(--vscode-editor-background);
            }
            .gpu-card.has-warning { border-color: var(--vscode-editorWarning-foreground); }
            .gpu-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
            .gpu-name-wrap { display: flex; align-items: center; gap: 7px; min-width: 0; }
            .gpu-index {
                flex: 0 0 auto;
                padding: 2px 5px;
                border-radius: 3px;
                color: var(--vscode-badge-foreground);
                background: var(--vscode-badge-background);
                font-size: 10px;
                font-weight: 600;
            }
            .gpu-heading h3 { overflow: hidden; margin: 0; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
            .utilization { flex: 0 0 auto; color: var(--vscode-charts-blue); font-size: 12px; }
            .memory-header { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 11px; }
            .progress-track { height: 6px; overflow: hidden; border-radius: 3px; background: var(--vscode-progressBar-background); opacity: .32; }
            .progress-fill { height: 100%; border-radius: inherit; background: var(--vscode-charts-blue); opacity: 1; }
            .progress-track:has(.progress-fill) { opacity: 1; background: var(--vscode-input-background); }
            .warning-fill { background: var(--vscode-editorWarning-foreground); }
            .warning-text, .metric.warning strong { color: var(--vscode-editorWarning-foreground); }
            .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 6px; margin-top: 9px; }
            .metric { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; min-width: 0; padding: 5px 6px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-size: 11px; }
            .metric-label { color: var(--vscode-descriptionForeground); }
            .metric strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .processes { margin-top: 8px; border-top: 1px solid var(--vscode-widget-border); }
            .processes summary { padding-top: 7px; color: var(--vscode-descriptionForeground); font-size: 11px; cursor: pointer; }
            .processes summary:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
            .process-list { display: grid; gap: 1px; margin-top: 6px; }
            .process-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 5px 6px; background: var(--vscode-textCodeBlock-background); font-size: 11px; }
            .process-identity { display: flex; flex-direction: column; min-width: 0; }
            .process-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .process-memory { flex: 0 0 auto; }
            .no-processes { padding: 5px 0; color: var(--vscode-descriptionForeground); font-size: 11px; }
            .error-state, .empty-state { padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; }
            .error-state { overflow: hidden; border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 4px; color: var(--vscode-errorForeground); text-overflow: ellipsis; }
            .compact-empty { padding: 12px; }
            @media (max-width: 720px) {
                body { padding: 12px; }
                .summary-strip { grid-template-columns: repeat(2, minmax(100px, 1fr)); }
                .toolbar { align-items: flex-start; }
                .toolbar-actions { flex-direction: column-reverse; }
                .gpu-grid.compact { grid-template-columns: 1fr; }
                .server-card-wide { grid-column: auto; }
            }
        `;
    }

    private _getNonce(): string {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let text = '';
        for (let i = 0; i < 32; i += 1) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
