import * as vscode from 'vscode';
import { SshConfigParser, SshHost } from './sshConfig';

export class GpuServerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const items: vscode.TreeItem[] = [];

        // Add Dashboard item
        const dashboardItem = new vscode.TreeItem('Dashboard', vscode.TreeItemCollapsibleState.None);
        dashboardItem.iconPath = new vscode.ThemeIcon('dashboard');
        dashboardItem.command = {
            command: 'gpu-fleet-viewer.openDashboard',
            title: 'Open Dashboard'
        };
        dashboardItem.contextValue = 'dashboard';
        items.push(dashboardItem);

        const displayHosts = GpuServerProvider.getHosts();
        const serverItems = displayHosts.map(h => new ServerTreeItem(h.host, vscode.TreeItemCollapsibleState.None));

        return Promise.resolve([...items, ...serverItems]);
    }

    public static getHosts(): SshHost[] {
        const config = vscode.workspace.getConfiguration('gpu-fleet-viewer');
        const configPath = config.get<string>('sshConfigPath') || '~/.ssh/config';
        const targets = config.get<string[]>('targets') || [];
        const additionalHosts = config.get<string[]>('additionalHosts') || [];
        const ignoredHosts = config.get<string[]>('ignoredHosts') || [];

        const parser = new SshConfigParser();
        const allHosts = parser.parse(configPath);

        const knownHosts = new Map(allHosts.map(host => [host.host, host]));
        let displayHosts = allHosts;
        if (targets.length > 0) {
            displayHosts = targets.map(host => knownHosts.get(host) || { host });
        }

        displayHosts = [
            ...displayHosts,
            ...additionalHosts.map(host => knownHosts.get(host) || { host })
        ];

        if (ignoredHosts.length > 0) {
            displayHosts = displayHosts.filter(h => !ignoredHosts.includes(h.host));
        }

        return Array.from(new Map(displayHosts.map(host => [host.host, host])).values());
    }
}

export class ServerTreeItem extends vscode.TreeItem {
    constructor(
        public readonly host: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(host, collapsibleState);
        this.tooltip = `SSH Host: ${host}`;
        this.description = ''; // Could show status here later
        this.contextValue = 'server';

        this.command = {
            command: 'gpu-fleet-viewer.openServer',
            title: 'Open GPU View',
            arguments: [this.host]
        };

        this.iconPath = new vscode.ThemeIcon('server');
    }
}
