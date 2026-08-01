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
let html = panel._getWebviewContent();
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
        processes
    };
}

const trainingProcess = (pid, user, usedMemory) => ({
    pid: String(pid),
    user,
    name: '/opt/conda/bin/python3',
    usedMemory: `${usedMemory} MiB`
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
        gpus: [
            gpu(0, 'NVIDIA RTX A6000', 10, 49140, 0, 31, 22, 300, 30),
            gpu(1, 'NVIDIA RTX A6000', 10, 49140, 0, 32, 23, 300, 31)
        ]
    },
    {
        host: 'a6000-west',
        gpus: [
            gpu(0, 'NVIDIA RTX A6000', 10, 49140, 0, 34, 25, 300, 30),
            gpu(1, 'NVIDIA RTX A6000', 10, 49140, 0, 33, 24, 300, 30)
        ]
    },
    { host: 'v100-cluster', gpus: v100s },
    {
        host: 'studio-4090',
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
        memoryWarningThreshold: 85,
        temperatureWarningThreshold: 80,
        powerWarningThreshold: 90
    },
    summary: {
        serversOnline: 4,
        serversTotal: 4,
        gpusAvailable: 6,
        gpusTotal: 14,
        memoryPercent: 49,
        memoryUsed: 201164,
        memoryTotal: 410308,
        utilizationPercent: 56,
        powerDraw: 2518,
        updatedAt: Date.now()
    }
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
