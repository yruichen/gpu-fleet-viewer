const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-refresh-'));
    const sshConfig = path.join(directory, 'ssh_config');
    fs.writeFileSync(sshConfig, 'Host lab-node\n');
    const values = new Map([['autoRefresh', false], ['sshConfigPath', sshConfig]]);
    const listeners = new Set();
    const configuration = {
        get: (key, fallback) => values.has(key) ? values.get(key) : fallback,
        update: async (key, value) => {
            values.set(key, value);
            for (const listener of listeners) listener({ affectsConfiguration: prefix => ('gpu-fleet-viewer.' + key).startsWith(prefix) });
        }
    };
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === 'vscode') return {
            TreeItem: class {}, ConfigurationTarget: { Global: 1 }, env: { language: 'en' },
            workspace: {
                getConfiguration: () => configuration,
                onDidChangeConfiguration: callback => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; }
            }
        };
        return originalLoad.call(this, request, parent, isMain);
    };
    const { GpuViewPanel } = require('../out/gpuView');
    Module._load = originalLoad;
    const messages = [];
    let visibility;
    const disposable = () => ({ dispose() {} });
    const webviewPanel = {
        visible: true, title: '',
        webview: { postMessage: async message => { messages.push(message); }, onDidReceiveMessage: disposable },
        onDidDispose: disposable,
        onDidChangeViewState: callback => { visibility = callback; return disposable(); }
    };
    const context = { globalState: { get: (_key, fallback) => fallback }, secrets: { get: async () => undefined } };
    const panel = new GpuViewPanel(webviewPanel, context);
    let releaseFirst;
    let calls = 0;
    let queryOptions;
    const snapshot = () => ({ gpus: [], healthAvailable: false, slurmAvailable: false, collectedAt: Date.now(), latencyMs: 1 });
    panel.monitor.getServerSnapshot = async (_host, options) => {
        calls++;
        queryOptions = options;
        if (calls === 1) await new Promise(resolve => { releaseFirst = resolve; });
        return snapshot();
    };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    try {
        const initial = panel.requestRefresh(false);
        await tick();
        const clicks = [panel.requestRefresh(true), panel.requestRefresh(true), panel.requestRefresh(true)];
        releaseFirst();
        await Promise.all([initial, ...clicks]);
        assert.strictEqual(calls, 2, 'Several refresh clicks during a query must queue only one follow-up.');
        assert.strictEqual(messages.filter(message => message.type === 'update').at(-1).refresh.active, false);
        await panel.handleMessage({ command: 'savePreferences', values: { showProcesses: false, showHostHealth: false, researchUser: 'alice' } });
        assert.strictEqual(calls, 3, 'Saving multiple data settings must cause one snapshot, not one per field.');
        assert.strictEqual(queryOptions.includeProcessOwners, true, 'My tasks must retain owner data when process details are hidden.');
        assert.ok(messages.some(message => message.type === 'preferencesResult' && message.success));
        visibility({ webviewPanel });
        await tick();
        assert.strictEqual(calls, 3, 'Returning to a freshly updated panel must reuse its snapshot.');
        await panel.handleMessage({ command: 'savePreferences', values: { showPower: false } });
        assert.strictEqual(calls, 3, 'A display-only setting must not query SSH.');
        assert.strictEqual(messages.filter(message => message.type === 'update').at(-1).settings.showPower, false);
        console.log('Refresh coalescing, batched settings, fresh panel reveal, and display-only updates passed.');
    } finally {
        panel.dispose();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
