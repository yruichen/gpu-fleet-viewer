const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
        return { TreeItem: class TreeItem {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

const { GpuViewPanel } = require('../out/gpuView');
const panel = Object.create(GpuViewPanel.prototype);
let html = panel.getWebviewContent();
const nonce = html.match(/<script nonce="([^"]+)">/)[1];

function gpu(index, name, used, total, utilization, temperature, power, limit, fan, processes = []) {
    return {
        index: String(index),
        uuid: `GPU-preview-${index}`,
        name,
        utilization: { gpu: `${utilization} %`, memory: `${Math.round((used / total) * 100)} %` },
        memory: { total: `${total} MiB`, used: `${used} MiB`, free: `${total - used} MiB` },
        temperature: { gpu: `${temperature} C` },
        power: { draw: `${power.toFixed(1)} W`, limit: `${limit.toFixed(1)} W` },
        fanSpeed: fan === null ? 'N/A' : `${fan} %`,
        processes,
        availability: {
            available: processes.length === 0 && used <= 512 && utilization <= 10,
            reasons: [
                ...(processes.length ? [processes.length + ' compute processes'] : []),
                ...(used > 512 ? [used + ' MiB memory used'] : []),
                ...(utilization > 10 ? [utilization + '% utilization'] : [])
            ]
        }
    };
}

const trainingProcess = (pid, user, usedMemory) => ({
    pid: String(pid),
    user,
    name: '/opt/conda/bin/python3',
    command: '/opt/conda/bin/python3 train.py --config experiments/large.yaml',
    elapsedSeconds: 18420,
    usedMemory: `${usedMemory} MiB`,
    slurm: user === 'ml-team' ? { id: '18422', name: 'llm-pretrain', state: 'RUNNING' } : undefined
});

const v100Memory = [24814, 30720, 4, 30742, 4, 24814, 26948, 26642];
const v100Utilization = [100, 10, 0, 100, 0, 100, 99, 98];
const v100Temperature = [69, 63, 45, 59, 33, 59, 54, 65];
const v100Power = [263, 77, 47, 296, 45, 227, 267, 276];
const v100s = v100Memory.map((used, index) => gpu(
    index,
    'Tesla V100-SXM2-32GB',
    used,
    32768,
    v100Utilization[index],
    v100Temperature[index],
    v100Power[index],
    300,
    null,
    used > 100
        ? (index === 1 || index === 3
            ? Array.from({ length: 7 }, (_, processIndex) => trainingProcess(41000 + index * 10 + processIndex, 'ml-team', 4386))
            : [trainingProcess(41000 + index, index % 2 ? 'alice' : 'research', used - 420)])
        : []
));

const data = [
    {
        host: 'a6000-east',
        collectedAt: Date.now(), latencyMs: 84, lastSuccessAt: Date.now(), stale: false,
        healthAvailable: true, slurmAvailable: false,
        health: { load1: 3.2, load5: 2.8, load15: 2.4, memoryTotalMiB: 262144, memoryUsedMiB: 98304, diskTotalMiB: 1953514, diskUsedMiB: 702118, uptimeSeconds: 918240 },
        metadata: { alias: 'Vision Lab A', group: 'A6000', favorite: true },
        gpus: [
            gpu(0, 'NVIDIA RTX A6000', 10, 49140, 0, 31, 22, 300, 30),
            gpu(1, 'NVIDIA RTX A6000', 10, 49140, 0, 32, 23, 300, 31)
        ]
    },
    {
        host: 'a6000-west',
        collectedAt: Date.now(), latencyMs: 96, lastSuccessAt: Date.now(), stale: false,
        healthAvailable: true, slurmAvailable: false,
        health: { load1: 1.1, load5: 1.4, load15: 1.2, memoryTotalMiB: 262144, memoryUsedMiB: 65536, diskTotalMiB: 1953514, diskUsedMiB: 542118, uptimeSeconds: 518240 },
        gpus: [
            gpu(0, 'NVIDIA RTX A6000', 10, 49140, 0, 34, 25, 300, 30),
            gpu(1, 'NVIDIA RTX A6000', 10, 49140, 0, 33, 24, 300, 30)
        ]
    },
    { host: 'v100-cluster', collectedAt: Date.now(), latencyMs: 71, lastSuccessAt: Date.now(), stale: false,
        healthAvailable: true, slurmAvailable: true,
        health: { load1: 18.4, load5: 16.2, load15: 14.8, memoryTotalMiB: 524288, memoryUsedMiB: 412720, diskTotalMiB: 3907028, diskUsedMiB: 1884210, uptimeSeconds: 1818240 },
        metadata: { alias: 'V100 Research Cluster', group: 'Shared Lab' }, gpus: v100s },
    {
        host: 'studio-4090',
        collectedAt: Date.now(), latencyMs: 42, lastSuccessAt: Date.now(), stale: false,
        healthAvailable: true, slurmAvailable: false,
        health: { load1: 4.7, load5: 4.3, load15: 3.9, memoryTotalMiB: 131072, memoryUsedMiB: 74218, diskTotalMiB: 1953514, diskUsedMiB: 1224118, uptimeSeconds: 318240 },
        gpus: [
            gpu(0, 'NVIDIA GeForce RTX 4090 D', 24017, 24564, 96, 72, 420, 450, 72, [trainingProcess(38291, 'alice', 23840)]),
            gpu(1, 'NVIDIA GeForce RTX 4090 D', 10, 24564, 0, 35, 18, 450, 30)
        ]
    }
];

const previewMessage = {
    type: 'update',
    title: 'Fleet Summary',
    data,
    settings: {
        compactLayout: true,
        showUtilization: true,
        showTemperature: true,
        showPower: true,
        showFanSpeed: true,
        showProcesses: true,
        showHostHealth: true,
        availabilityRequireNoProcesses: true,
        availabilityMaxMemoryMiB: 512,
        availabilityMaxUtilization: 10,
        memoryWarningThreshold: 85,
        temperatureWarningThreshold: 80,
        powerWarningThreshold: 90
    },
    summary: {
        serversOnline: 4,
        serversTotal: 4,
        gpusAvailable: 6,
        gpusTotal: 14,
        warnings: 5,
        memoryPercent: 49,
        memoryUsed: 201164,
        memoryTotal: 410308,
        utilizationPercent: 56,
        powerDraw: 2518,
        updatedAt: Date.now()
    },
    users: [
        { user: 'ml-team', gpuCount: 2, processCount: 14, memoryMiB: 61404 },
        { user: 'alice', gpuCount: 2, processCount: 2, memoryMiB: 50482 },
        { user: 'research', gpuCount: 3, processCount: 3, memoryMiB: 77844 }
    ]
};

const theme = `<style>
:root {
    --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --vscode-font-size: 13px;
    --vscode-foreground: #cccccc;
    --vscode-descriptionForeground: #9da3aa;
    --vscode-editor-background: #1f2428;
    --vscode-sideBar-background: #252a2e;
    --vscode-widget-border: #3b4248;
    --vscode-button-background: #0e7a32;
    --vscode-button-hoverBackground: #159447;
    --vscode-button-foreground: #ffffff;
    --vscode-button-secondaryBackground: #343b41;
    --vscode-button-secondaryHoverBackground: #444c54;
    --vscode-button-secondaryForeground: #ffffff;
    --vscode-badge-background: #3c4650;
    --vscode-badge-foreground: #ffffff;
    --vscode-testing-iconPassed: #3fb950;
    --vscode-errorForeground: #f85149;
    --vscode-editorWarning-foreground: #d29922;
    --vscode-inputValidation-errorBorder: #be1100;
    --vscode-charts-blue: #58a6ff;
    --vscode-progressBar-background: #58a6ff;
    --vscode-input-background: #11161a;
    --vscode-textCodeBlock-background: #2b3137;
    --vscode-focusBorder: #58a6ff;
}
</style>`;

html = html.replace('</head>', `${theme}</head>`);
html = html.replace(
    'const vscode = acquireVsCodeApi();',
    `const vscode = { postMessage(message) {
        if (message.command === 'refresh') {
            window.__gpuPreview.summary.updatedAt = Date.now();
            window.postMessage(window.__gpuPreview, '*');
        } else if (message.command === 'connect') {
            document.getElementById('refresh-state').textContent = 'Connect requested for ' + message.host;
        } else if (message.command === 'settings') {
            document.getElementById('refresh-state').textContent = 'Settings command requested';
        } else if (message.command === 'openGpuTerminal' || message.command === 'copyValue') {
            document.getElementById('refresh-state').textContent = message.command + ' requested';
        }
    } };`
);
html = html.replace(
    '</body>',
    `<script nonce="${nonce}">
        window.__gpuPreview = ${JSON.stringify(previewMessage)};
        window.postMessage(window.__gpuPreview, '*');
    </script></body>`
);

const previewDirectory = path.join(__dirname, '..', 'preview');
fs.mkdirSync(previewDirectory, { recursive: true });
fs.writeFileSync(path.join(previewDirectory, 'index.html'), html);
console.log('Preview generated at preview/index.html');
