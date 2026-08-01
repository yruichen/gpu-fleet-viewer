export function getDashboardScript(): string {
    return `
        const vscode = acquireVsCodeApi();
        const content = document.getElementById('content');
        const summaryRoot = document.getElementById('summary');
        const refreshState = document.getElementById('refresh-state');
        const pageTitle = document.getElementById('page-title');
        let currentMessage;
        let selectedGpuKey;

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

        function formatMemory(value) {
            const amount = number(value);
            if (amount >= 1024) return (amount / 1024).toFixed(amount >= 10240 ? 1 : 2) + ' GiB';
            return Math.round(amount) + ' MiB';
        }

        function formatPower(value) {
            const amount = number(value);
            return amount >= 1000 ? (amount / 1000).toFixed(2) + ' kW' : Math.round(amount) + ' W';
        }

        function shortProcessName(value) {
            const parts = String(value).split('/');
            return parts[parts.length - 1] || value;
        }

        function progress(value, warning) {
            const track = node('div', 'progress-track');
            track.setAttribute('role', 'progressbar');
            track.setAttribute('aria-valuenow', String(Math.round(value)));
            track.setAttribute('aria-valuemin', '0');
            track.setAttribute('aria-valuemax', '100');
            const fill = node('div', warning ? 'progress-fill warning-fill' : 'progress-fill');
            fill.style.width = Math.min(100, value) + '%';
            track.append(fill);
            return track;
        }

        function renderSummary(summary) {
            summaryRoot.replaceChildren();
            const onlinePercent = summary.serversTotal
                ? Math.round((summary.serversOnline / summary.serversTotal) * 100)
                : 0;
            const items = [
                ['Servers', String(summary.serversTotal)],
                ['GPUs', summary.gpusTotal + ' total'],
                ['Online', onlinePercent + '%'],
                ['Avg utilization', summary.utilizationPercent + '%'],
                ['Memory', formatMemory(summary.memoryUsed) + ' / ' + formatMemory(summary.memoryTotal)],
                ['Power', formatPower(summary.powerDraw)]
            ];
            for (const [label, value] of items) {
                const item = node('div', label === 'Online' && onlinePercent === 100 ? 'summary-item healthy' : 'summary-item');
                item.append(node('strong', 'summary-value', value), node('span', 'summary-label', label));
                summaryRoot.append(item);
            }
        }

        function addMetric(root, value, warning) {
            if (!value || value === 'N/A') return;
            root.append(node('span', warning ? 'metric warning' : 'metric', value));
        }

        function renderGpu(server, gpu, settings) {
            const key = server.host + ':' + gpu.index;
            const memoryPercent = percent(gpu.memory.used, gpu.memory.total);
            const temperature = number(gpu.temperature.gpu);
            const powerPercent = percent(gpu.power.draw, gpu.power.limit);
            const hasWarning = memoryPercent >= settings.memoryWarningThreshold ||
                temperature >= settings.temperatureWarningThreshold ||
                powerPercent >= settings.powerWarningThreshold;
            const selected = selectedGpuKey === key;
            const card = node('button', 'gpu-tile' + (hasWarning ? ' has-warning' : '') + (selected ? ' selected' : ''));
            card.type = 'button';
            card.setAttribute('aria-pressed', selected ? 'true' : 'false');

            const heading = node('div', 'gpu-heading');
            const identity = node('div', 'gpu-identity');
            identity.append(node('span', 'gpu-index', 'GPU ' + gpu.index), node('strong', 'gpu-name', gpu.name));
            heading.append(identity);
            if (settings.showUtilization && gpu.utilization.gpu !== 'N/A') {
                heading.append(node('strong', hasWarning ? 'gpu-util warning-text' : 'gpu-util', gpu.utilization.gpu));
            }
            card.append(heading);

            const memoryRow = node('div', 'memory-row');
            memoryRow.append(
                node('span', '', 'Memory'),
                node('span', memoryPercent >= settings.memoryWarningThreshold ? 'warning-text' : '', gpu.memory.used + ' / ' + gpu.memory.total)
            );
            card.append(memoryRow, progress(memoryPercent, memoryPercent >= settings.memoryWarningThreshold));

            const metrics = node('div', 'metrics');
            if (settings.showTemperature) {
                addMetric(metrics, gpu.temperature.gpu.replace(' C', '°C'), temperature >= settings.temperatureWarningThreshold);
            }
            if (settings.showPower && gpu.power.draw !== 'N/A') {
                const power = gpu.power.draw + (gpu.power.limit !== 'N/A' ? ' / ' + gpu.power.limit : '');
                addMetric(metrics, power, powerPercent >= settings.powerWarningThreshold);
            }
            if (settings.showFanSpeed) {
                addMetric(metrics, gpu.fanSpeed, false);
            }
            if (metrics.childElementCount) card.append(metrics);

            if (settings.showProcesses) {
                const count = gpu.processes.length;
                card.append(node('div', 'process-count', count + (count === 1 ? ' process' : ' processes')));
                card.addEventListener('click', () => {
                    selectedGpuKey = selectedGpuKey === key ? undefined : key;
                    render(currentMessage);
                });
            }
            return card;
        }

        function renderInspector(server, gpu) {
            const inspector = node('section', 'process-inspector');
            const header = node('header', 'inspector-header');
            const title = node('div', 'inspector-title');
            title.append(
                node('strong', '', server.host + '  ›  GPU ' + gpu.index),
                node('span', 'subtle', gpu.name)
            );
            const close = node('button', 'inspector-close', 'Close');
            close.addEventListener('click', () => {
                selectedGpuKey = undefined;
                render(currentMessage);
            });
            header.append(title, close);
            inspector.append(header);

            if (!gpu.processes.length) {
                inspector.append(node('div', 'inspector-empty', 'No active GPU processes'));
                return inspector;
            }

            const table = node('table', 'process-table');
            const tableHead = node('thead');
            const headingRow = node('tr');
            for (const heading of ['Process', 'PID', 'User', 'Memory']) {
                headingRow.append(node('th', '', heading));
            }
            tableHead.append(headingRow);
            const tableBody = node('tbody');
            for (const process of gpu.processes) {
                const row = node('tr');
                const name = node('td', 'process-name', shortProcessName(process.name));
                name.title = process.name;
                row.append(
                    name,
                    node('td', '', process.pid),
                    node('td', '', process.user),
                    node('td', 'numeric', process.usedMemory)
                );
                tableBody.append(row);
            }
            table.append(tableHead, tableBody);
            inspector.append(table);
            return inspector;
        }

        function renderServer(server, settings) {
            const band = node('section', server.error ? 'server-band offline' : 'server-band online');
            const summary = node('aside', 'server-summary');
            const titleRow = node('div', 'server-title-row');
            titleRow.append(
                node('h2', '', server.host),
                node('span', 'server-state', server.error ? 'Offline' : server.gpus.length + ' GPUs online')
            );
            summary.append(titleRow);

            if (server.error) {
                const error = node('div', 'server-error', server.error);
                error.title = server.error;
                summary.append(error);
            } else {
                const used = server.gpus.reduce((total, gpu) => total + number(gpu.memory.used), 0);
                const total = server.gpus.reduce((amount, gpu) => amount + number(gpu.memory.total), 0);
                const memoryPercent = total ? (used / total) * 100 : 0;
                const averageUtilization = server.gpus.length
                    ? Math.round(server.gpus.reduce((amount, gpu) => amount + number(gpu.utilization.gpu), 0) / server.gpus.length)
                    : 0;
                summary.append(
                    node('div', 'server-memory', formatMemory(used) + ' / ' + formatMemory(total)),
                    progress(memoryPercent, memoryPercent >= settings.memoryWarningThreshold),
                    node('div', 'server-stat', Math.round(memoryPercent) + '% memory used'),
                    node('div', 'server-stat', averageUtilization + '% avg utilization')
                );
            }

            const connect = node('button', 'secondary-button server-connect', 'Connect');
            connect.addEventListener('click', () => vscode.postMessage({ command: 'connect', host: server.host }));
            summary.append(connect);
            band.append(summary);

            const serverContent = node('div', 'server-content');
            if (!server.error && server.gpus.length) {
                const gridClass = 'gpu-matrix' + (server.gpus.length <= 2 ? ' two-gpus' : '');
                const grid = node('div', gridClass);
                for (const gpu of server.gpus) grid.append(renderGpu(server, gpu, settings));
                serverContent.append(grid);

                const selectedGpu = server.gpus.find(gpu => selectedGpuKey === server.host + ':' + gpu.index);
                if (settings.showProcesses && selectedGpu) {
                    serverContent.append(renderInspector(server, selectedGpu));
                }
            } else if (!server.error) {
                serverContent.append(node('div', 'empty-state compact-empty', 'No NVIDIA GPUs found'));
            }
            band.append(serverContent);
            return band;
        }

        function render(message) {
            currentMessage = message;
            pageTitle.textContent = message.title;
            refreshState.textContent = 'Updated ' + new Date(message.summary.updatedAt).toLocaleTimeString();
            renderSummary(message.summary);
            content.replaceChildren();

            if (!message.data.length) {
                content.append(node('div', 'empty-state', 'No servers found. Add an SSH target or check extension settings.'));
                return;
            }

            const labels = node('div', 'column-labels');
            labels.append(node('span', '', 'Server'), node('span', '', 'GPUs'));
            const fleet = node('div', 'fleet');
            for (const server of message.data) fleet.append(renderServer(server, message.settings));
            content.append(labels, fleet);
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

export function getDashboardCss(): string {
    return `
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 16px 18px 24px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        button {
            min-height: 28px;
            padding: 4px 11px;
            border: 1px solid transparent;
            border-radius: 3px;
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            font: inherit;
            cursor: pointer;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
        button:disabled { cursor: wait; opacity: .65; }
        .secondary-button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
        .secondary-button:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            min-height: 34px;
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .toolbar h1 {
            margin: 0;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            font-weight: 600;
            letter-spacing: .06em;
            text-transform: uppercase;
        }
        .toolbar-actions { display: flex; align-items: center; gap: 8px; }
        .subtle { color: var(--vscode-descriptionForeground); font-size: 11px; }
        .summary-strip {
            display: grid;
            grid-template-columns: repeat(6, minmax(100px, 1fr));
            border-bottom: 1px solid var(--vscode-widget-border);
        }
        .summary-item {
            display: flex;
            flex-direction: column;
            gap: 3px;
            min-width: 0;
            padding: 10px 14px;
            border-right: 1px solid var(--vscode-widget-border);
        }
        .summary-item:last-child { border-right: 0; }
        .summary-label { color: var(--vscode-descriptionForeground); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
        .summary-value { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .summary-item.healthy .summary-value { color: var(--vscode-testing-iconPassed); }
        .column-labels {
            display: grid;
            grid-template-columns: 210px minmax(0, 1fr);
            padding: 8px 0 6px;
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            font-weight: 600;
            letter-spacing: .05em;
            text-transform: uppercase;
        }
        .column-labels span { padding-left: 12px; }
        .fleet { display: grid; gap: 8px; }
        .server-band {
            display: grid;
            grid-template-columns: 210px minmax(0, 1fr);
            min-width: 0;
            overflow: hidden;
            border: 1px solid var(--vscode-widget-border);
            border-left: 3px solid var(--vscode-errorForeground);
            border-radius: 4px;
            background: var(--vscode-sideBar-background);
        }
        .server-band.online { border-left-color: var(--vscode-testing-iconPassed); }
        .server-band:has(.gpu-tile.selected) { border-color: var(--vscode-focusBorder); border-left-width: 3px; }
        .server-summary {
            display: flex;
            flex-direction: column;
            min-width: 0;
            padding: 11px 12px;
            border-right: 1px solid var(--vscode-widget-border);
        }
        .server-title-row { display: flex; align-items: baseline; gap: 7px; min-width: 0; margin-bottom: 9px; }
        .server-title-row h2 { overflow: hidden; margin: 0; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .server-state { color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; white-space: nowrap; }
        .server-memory { margin-bottom: 4px; font-size: 11px; }
        .server-stat { margin-top: 6px; color: var(--vscode-descriptionForeground); font-size: 10px; text-transform: uppercase; }
        .server-connect { align-self: flex-start; margin-top: auto; }
        .server-error { overflow: hidden; margin-bottom: 10px; color: var(--vscode-errorForeground); font-size: 11px; text-overflow: ellipsis; }
        .server-content { min-width: 0; padding: 8px; }
        .gpu-matrix { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 7px; }
        .gpu-matrix.two-gpus { grid-template-columns: repeat(2, minmax(230px, 340px)); }
        .gpu-tile {
            display: flex;
            flex-direction: column;
            min-width: 0;
            min-height: 126px;
            padding: 9px;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 3px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            text-align: left;
        }
        .gpu-tile:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
        .gpu-tile.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
        .gpu-tile.has-warning:not(.selected) { border-color: var(--vscode-editorWarning-foreground); }
        .gpu-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin-bottom: 8px; }
        .gpu-identity { display: flex; align-items: center; gap: 7px; min-width: 0; }
        .gpu-index { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 600; }
        .gpu-name { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .gpu-util { flex: 0 0 auto; color: var(--vscode-charts-blue); font-size: 11px; }
        .memory-row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 10px; }
        .memory-row span:last-child { color: var(--vscode-foreground); white-space: nowrap; }
        .progress-track { height: 5px; overflow: hidden; border-radius: 2px; background: var(--vscode-input-background); }
        .progress-fill { height: 100%; border-radius: inherit; background: var(--vscode-charts-blue); }
        .warning-fill { background: var(--vscode-editorWarning-foreground); }
        .warning-text, .metric.warning { color: var(--vscode-editorWarning-foreground); }
        .metrics { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
        .metric { padding: 3px 5px; border-radius: 2px; background: var(--vscode-textCodeBlock-background); font-size: 10px; white-space: nowrap; }
        .process-count { margin-top: auto; padding-top: 7px; color: var(--vscode-descriptionForeground); font-size: 10px; }
        .process-inspector { margin-top: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 3px; background: var(--vscode-editor-background); }
        .inspector-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border); }
        .inspector-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .inspector-title strong { font-size: 11px; }
        .inspector-close { min-height: 22px; padding: 2px 7px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-size: 10px; }
        .inspector-empty { padding: 14px; color: var(--vscode-descriptionForeground); text-align: center; }
        .process-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
        .process-table th, .process-table td { overflow: hidden; padding: 5px 9px; border-bottom: 1px solid var(--vscode-widget-border); text-align: left; text-overflow: ellipsis; white-space: nowrap; }
        .process-table th { color: var(--vscode-descriptionForeground); font-size: 9px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; }
        .process-table tr:last-child td { border-bottom: 0; }
        .process-table th:first-child, .process-table td:first-child { width: 42%; }
        .process-table .numeric { text-align: right; }
        .empty-state { padding: 22px; color: var(--vscode-descriptionForeground); text-align: center; }
        .compact-empty { padding: 12px; }
        @media (max-width: 1150px) {
            .summary-strip { grid-template-columns: repeat(3, minmax(100px, 1fr)); }
            .summary-item:nth-child(3) { border-right: 0; }
            .column-labels, .server-band { grid-template-columns: 180px minmax(0, 1fr); }
            .gpu-matrix { grid-template-columns: repeat(2, minmax(190px, 1fr)); }
        }
        @media (max-width: 760px) {
            body { padding: 10px; }
            .toolbar { align-items: flex-start; }
            .toolbar-actions { flex-wrap: wrap; justify-content: flex-end; }
            .summary-strip { grid-template-columns: repeat(2, minmax(100px, 1fr)); }
            .summary-item:nth-child(3) { border-right: 1px solid var(--vscode-widget-border); }
            .summary-item:nth-child(even) { border-right: 0; }
            .column-labels { display: none; }
            .server-band { grid-template-columns: 1fr; }
            .server-summary { border-right: 0; border-bottom: 1px solid var(--vscode-widget-border); }
            .server-connect { margin-top: 10px; }
            .gpu-matrix, .gpu-matrix.two-gpus { grid-template-columns: 1fr; }
            .process-table th:first-child, .process-table td:first-child { width: 32%; }
        }
    `;
}
