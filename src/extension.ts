import * as vscode from 'vscode';
import { GpuServerProvider } from './serverProvider';
import { GpuStatusSummary, GpuViewPanel } from './gpuView';
import { SshConfigParser } from './sshConfig';
import { TaskService } from './taskService';

const configurationKeys = [
    'language',
    'sshConfigPath',
    'targets',
    'additionalHosts',
    'ignoredHosts',
    'autoRefresh',
    'refreshInterval',
    'sshTimeout',
    'maxConcurrentHosts',
    'pauseWhenHidden',
    'compactLayout',
    'showUtilization',
    'showTemperature',
    'showPower',
    'showFanSpeed',
    'showProcesses',
    'showHostHealth',
    'enableSlurmIntegration',
    'slurmRefreshInterval',
    'availabilityRequireNoProcesses',
    'availabilityMaxMemoryMiB',
    'availabilityMaxUtilization',
    'showStatusBar',
    'enableNotifications',
    'notificationEvents',
    'notificationCooldownSeconds',
    'memoryWarningThreshold',
    'temperatureWarningThreshold',
    'powerWarningThreshold'
] as const;

async function migrateLegacySettings(): Promise<void> {
    const legacy = vscode.workspace.getConfiguration('gpu-server-viewer');
    const current = vscode.workspace.getConfiguration('gpu-fleet-viewer');

    for (const key of configurationKeys) {
        const oldValue = legacy.inspect<unknown>(key)?.globalValue;
        const newValue = current.inspect<unknown>(key)?.globalValue;
        if (newValue === undefined && oldValue !== undefined) {
            await current.update(key, oldValue, vscode.ConfigurationTarget.Global);
        }
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    await migrateLegacySettings();
    TaskService.get(context);
    const serverProvider = new GpuServerProvider();
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'gpu-fleet-viewer.openDashboard';
    statusBar.name = 'GPU Fleet Viewer';
    statusBar.text = '$(dashboard) GPU Fleet';
    statusBar.tooltip = 'Open GPU Dashboard';

    const updateStatusBarVisibility = () => {
        const visible = vscode.workspace
            .getConfiguration('gpu-fleet-viewer')
            .get<boolean>('showStatusBar', true);
        if (visible) {
            statusBar.show();
        } else {
            statusBar.hide();
        }
    };

    const updateStatusBar = (summary: GpuStatusSummary) => {
        statusBar.text = `$(dashboard) GPU ${summary.gpusAvailable}/${summary.gpusTotal} free`;
        statusBar.tooltip = new vscode.MarkdownString(
            `**GPU Fleet Viewer**  \n` +
            `${summary.serversOnline}/${summary.serversTotal} servers online  \n` +
            `${summary.gpusAvailable}/${summary.gpusTotal} GPUs available  \n` +
            `${summary.memoryPercent}% aggregate memory used`
        );
    };

    const openDashboard = (host?: string) => {
        GpuViewPanel.createOrShow(context, host, host ? undefined : updateStatusBar);
    };

    context.subscriptions.push(
        statusBar,
        vscode.window.registerTreeDataProvider('gpuServerList', serverProvider),
        vscode.commands.registerCommand('gpu-fleet-viewer.refresh', () => {
            serverProvider.refresh();
            GpuViewPanel.refreshAll();
        }),
        vscode.commands.registerCommand('gpu-fleet-viewer.addServer', async () => {
            const target = await vscode.window.showInputBox({
                title: 'Add GPU server',
                prompt: 'Enter an SSH config alias, IP address, hostname, or user@host',
                placeHolder: 'user@gpu-node-01',
                ignoreFocusOut: true,
                validateInput: value => {
                    const trimmed = value.trim();
                    if (!trimmed) {
                        return 'Enter an SSH target.';
                    }
                    if (trimmed.startsWith('-') || !/^[A-Za-z0-9_.:@-]+$/.test(trimmed)) {
                        return 'Use only a host alias, hostname, IP address, or user@host.';
                    }
                    return undefined;
                }
            });

            if (!target) {
                return;
            }

            const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
            const current = config.get<string[]>('additionalHosts', []);
            const updated = Array.from(new Set([...current, target.trim()]));
            await config.update('additionalHosts', updated, vscode.ConfigurationTarget.Global);
            serverProvider.refresh();

            const action = await vscode.window.showInformationMessage(
                `Added GPU server ${target.trim()}.`,
                'Open Dashboard'
            );
            if (action === 'Open Dashboard') {
                openDashboard();
            }
        }),
        vscode.commands.registerCommand('gpu-fleet-viewer.openServer', (host: string) => openDashboard(host)),
        vscode.commands.registerCommand('gpu-fleet-viewer.openDashboard', () => openDashboard()),
        vscode.commands.registerCommand('gpu-fleet-viewer.findAvailableGpu', () => {
            void GpuViewPanel.showAvailableGpuQuickPick();
        }),
        vscode.commands.registerCommand('gpu-fleet-viewer.openSettings', () => {
            void vscode.commands.executeCommand(
                'workbench.action.openSettings',
                '@ext:yruichen.gpu-fleet-viewer'
            );
        }),
        vscode.commands.registerCommand('gpu-fleet-viewer.connectSsh', (item: unknown) => {
            let host = '';
            if (typeof item === 'string') {
                host = item;
            } else if (item && typeof item === 'object' && 'host' in item) {
                host = String((item as { host: unknown }).host);
            }

            if (host) {
                void vscode.commands.executeCommand('vscode.newWindow', {
                    remoteAuthority: `ssh-remote+${host}`
                });
            }
        }),
        vscode.commands.registerCommand('gpu-fleet-viewer.configureServers', async () => {
            const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
            const configPath = config.get<string>('sshConfigPath') || '~/.ssh/config';
            const targets = config.get<string[]>('targets') || [];
            const additionalHosts = config.get<string[]>('additionalHosts') || [];
            const ignored = config.get<string[]>('ignoredHosts') || [];

            const allHosts = new SshConfigParser().parse(configPath);
            const configuredHosts = targets.length
                ? targets
                : allHosts.map(host => host.host);
            const candidates = Array.from(new Set([...configuredHosts, ...additionalHosts]));
            const items: vscode.QuickPickItem[] = candidates.map(host => ({
                label: host,
                picked: !ignored.includes(host)
            }));

            const selected = await vscode.window.showQuickPick(items, {
                canPickMany: true,
                placeHolder: 'Select servers to show',
                title: 'Visible GPU servers'
            });

            if (selected) {
                const selectedHosts = new Set(selected.map(item => item.label));
                const newIgnored = candidates.filter(host => !selectedHosts.has(host));
                await config.update('ignoredHosts', newIgnored, vscode.ConfigurationTarget.Global);
                serverProvider.refresh();
            }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('gpu-fleet-viewer.showStatusBar')) {
                updateStatusBarVisibility();
            }
            if (event.affectsConfiguration('gpu-fleet-viewer.targets') ||
                event.affectsConfiguration('gpu-fleet-viewer.additionalHosts') ||
                event.affectsConfiguration('gpu-fleet-viewer.ignoredHosts') ||
                event.affectsConfiguration('gpu-fleet-viewer.sshConfigPath')) {
                serverProvider.refresh();
            }
        })
    );

    updateStatusBarVisibility();
}

export function deactivate(): void {}
