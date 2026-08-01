export function getDashboardScript(): string {
    return `
        const vscode = acquireVsCodeApi();
        const content = document.getElementById('content');
        const summaryRoot = document.getElementById('summary');
        const usersRoot = document.getElementById('user-filters');
        const refreshState = document.getElementById('refresh-state');
        const pageTitle = document.getElementById('page-title');
        const searchInput = document.getElementById('search-input');
        const statusFilter = document.getElementById('status-filter');
        const sortSelect = document.getElementById('sort-select');
        let currentMessage;
        let selectedGpuKey;
        let selectedUser = '';

        document.getElementById('refresh-button').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
        document.getElementById('settings-button').addEventListener('click', () => vscode.postMessage({ command: 'settings' }));
        searchInput.addEventListener('input', () => renderFleet());
        statusFilter.addEventListener('change', () => renderFleet());
        sortSelect.addEventListener('change', () => renderFleet());

        function node(tag, className, text) {
            const element = document.createElement(tag);
            if (className) element.className = className;
            if (text !== undefined) element.textContent = text;
            return element;
        }

        function button(label, className, handler, title) {
            const element = node('button', className, label);
            element.type = 'button';
            if (title) element.title = title;
            element.addEventListener('click', event => {
                event.stopPropagation();
                handler();
            });
            return element;
        }

        function number(value) {
            const parsed = Number.parseFloat(String(value || '').replace(/[^0-9.-]/g, ''));
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function percent(value, total) {
            const maximum = number(total);
            return maximum > 0 ? number(value) / maximum * 100 : 0;
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

        function formatDuration(seconds) {
            const value = number(seconds);
            if (!value) return '—';
            const days = Math.floor(value / 86400);
            const hours = Math.floor(value % 86400 / 3600);
            const minutes = Math.floor(value % 3600 / 60);
            return days ? days + 'd ' + hours + 'h' : hours ? hours + 'h ' + minutes + 'm' : minutes + 'm';
        }

        function progress(value, warning) {
            const track = node('div', 'progress-track');
            track.setAttribute('role', 'progressbar');
            track.setAttribute('aria-valuenow', String(Math.round(value)));
            track.setAttribute('aria-valuemin', '0');
            track.setAttribute('aria-valuemax', '100');
            const fill = node('div', warning ? 'progress-fill warning-fill' : 'progress-fill');
            fill.style.width = Math.min(100, Math.max(0, value)) + '%';
            track.append(fill);
            return track;
        }

        function hasWarning(gpu, settings) {
            return percent(gpu.memory.used, gpu.memory.total) >= settings.memoryWarningThreshold ||
                number(gpu.temperature.gpu) >= settings.temperatureWarningThreshold ||
                percent(gpu.power.draw, gpu.power.limit) >= settings.powerWarningThreshold;
        }

        function renderSummary(summary) {
            summaryRoot.replaceChildren();
            const items = [
                ['Servers', summary.serversOnline + ' / ' + summary.serversTotal],
                ['Physical GPUs', String(summary.gpusTotal)],
                ['Available', String(summary.gpusAvailable)],
                ['Warnings', String(summary.warnings)],
                ['Memory', summary.memoryPercent + '% used'],
                ['Power', formatPower(summary.powerDraw)]
            ];
            const fragment = document.createDocumentFragment();
            for (const [label, value] of items) {
                const item = node('div', 'summary-item' + (label === 'Available' ? ' available-summary' : ''));
                item.append(node('strong', 'summary-value', value), node('span', 'summary-label', label));
                fragment.append(item);
            }
            summaryRoot.append(fragment);
        }

        function renderUsers(users) {
            usersRoot.replaceChildren();
            if (!users.length) {
                usersRoot.hidden = true;
                return;
            }
            usersRoot.hidden = false;
            usersRoot.append(node('span', 'filter-label', 'Active users'));
            usersRoot.append(button('All', selectedUser ? 'user-chip' : 'user-chip active', () => {
                selectedUser = '';
                renderUsers(currentMessage.users);
                renderFleet();
            }));
            for (const user of users) {
                const label = user.user + ' · ' + user.gpuCount + ' GPU · ' + formatMemory(user.memoryMiB);
                usersRoot.append(button(label, selectedUser === user.user ? 'user-chip active' : 'user-chip', () => {
                    selectedUser = selectedUser === user.user ? '' : user.user;
                    renderUsers(currentMessage.users);
                    renderFleet();
                }));
            }
        }

        function matchesGpu(server, gpu) {
            const query = searchInput.value.trim().toLowerCase();
            const processes = gpu.processes || [];
            if (selectedUser && !processes.some(process => process.user === selectedUser)) return false;
            if (query) {
                const haystack = [server.host, server.metadata && server.metadata.alias,
                    server.metadata && server.metadata.group, gpu.name, gpu.uuid,
                    ...processes.flatMap(process => [process.user, process.name, process.command,
                        process.slurm && process.slurm.id, process.slurm && process.slurm.name])]
                    .filter(Boolean).join(' ').toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            const status = statusFilter.value;
            if (status === 'available' && !gpu.availability.available) return false;
            if (status === 'busy' && gpu.availability.available) return false;
            if (status === 'warning' && !hasWarning(gpu, currentMessage.settings)) return false;
            if (status === 'offline') return Boolean(server.error);
            return true;
        }

        function sortedGpus(gpus) {
            const result = [...gpus];
            if (sortSelect.value === 'freeMemory') result.sort((a, b) => number(b.memory.free) - number(a.memory.free));
            if (sortSelect.value === 'utilization') result.sort((a, b) => number(a.utilization.gpu) - number(b.utilization.gpu));
            if (sortSelect.value === 'temperature') result.sort((a, b) => number(a.temperature.gpu) - number(b.temperature.gpu));
            return result;
        }

        function metric(label, value, warning) {
            if (!value || value === 'N/A') return undefined;
            const item = node('div', warning ? 'metric warning' : 'metric');
            item.append(node('span', '', label), node('strong', '', value));
            return item;
        }

        function renderGpu(server, gpu, settings) {
            const key = server.host + ':' + gpu.uuid;
            const memoryPercent = percent(gpu.memory.used, gpu.memory.total);
            const warning = hasWarning(gpu, settings);
            const selected = selectedGpuKey === key;
            const card = node('article', 'gpu-tile' + (warning ? ' has-warning' : '') +
                (selected ? ' selected' : '') + (gpu.availability.available ? ' available' : ' busy'));

            const main = button('', 'gpu-main', () => {
                if (settings.showProcesses) {
                    selectedGpuKey = selected ? undefined : key;
                    renderFleet();
                }
            }, settings.showProcesses ? 'Inspect this GPU' : gpu.name);
            const heading = node('div', 'gpu-heading');
            const identity = node('div', 'gpu-identity');
            identity.append(node('span', 'gpu-index', 'GPU ' + gpu.index), node('strong', 'gpu-name', gpu.name));
            const state = node('span', gpu.availability.available ? 'availability available' : 'availability busy',
                gpu.availability.available ? 'Available' : 'Busy');
            state.title = gpu.availability.available ? 'Matches your availability rules' : gpu.availability.reasons.join(' · ');
            heading.append(identity, state);
            main.append(heading);

            const memoryRow = node('div', 'memory-row');
            memoryRow.append(node('span', '', 'Memory'), node('span', memoryPercent >= settings.memoryWarningThreshold ? 'warning-text' : '',
                gpu.memory.used + ' / ' + gpu.memory.total));
            main.append(memoryRow, progress(memoryPercent, memoryPercent >= settings.memoryWarningThreshold));

            const metrics = node('div', 'metrics');
            const values = [];
            if (settings.showUtilization) values.push(metric('Util', gpu.utilization.gpu, false));
            if (settings.showTemperature) values.push(metric('Temp', gpu.temperature.gpu.replace(' C', '°C'),
                number(gpu.temperature.gpu) >= settings.temperatureWarningThreshold));
            if (settings.showPower && gpu.power.draw !== 'N/A') values.push(metric('Power', gpu.power.draw,
                percent(gpu.power.draw, gpu.power.limit) >= settings.powerWarningThreshold));
            if (settings.showFanSpeed) values.push(metric('Fan', gpu.fanSpeed, false));
            values.filter(Boolean).forEach(value => metrics.append(value));
            if (metrics.childElementCount) main.append(metrics);
            if (settings.showProcesses) {
                main.append(node('div', 'process-count', gpu.processes.length + (gpu.processes.length === 1 ? ' compute process' : ' compute processes')));
            }
            card.append(main);

            const actions = node('div', 'gpu-actions');
            actions.append(
                button('Open terminal', gpu.availability.available ? 'action-button primary-action' : 'action-button',
                    () => vscode.postMessage({ command: 'openGpuTerminal', host: server.host, uuid: gpu.uuid })),
                button('Copy CUDA env', 'action-button',
                    () => vscode.postMessage({ command: 'copyValue', kind: 'cuda', host: server.host, uuid: gpu.uuid }))
            );
            card.append(actions);
            return card;
        }

        function renderInspector(server, gpu) {
            const inspector = node('section', 'process-inspector');
            const header = node('header', 'inspector-header');
            const title = node('div');
            title.append(node('strong', '', (server.metadata && server.metadata.alias || server.host) + ' · GPU ' + gpu.index),
                node('span', 'subtle block', gpu.name + ' · ' + gpu.uuid));
            header.append(title, button('Close', 'secondary-button compact-button', () => {
                selectedGpuKey = undefined;
                renderFleet();
            }));
            inspector.append(header);
            if (!gpu.processes.length) {
                inspector.append(node('div', 'inspector-empty', 'No active compute processes. This GPU is ready for a new experiment.'));
                return inspector;
            }
            const scroll = node('div', 'process-scroll');
            const table = node('table', 'process-table');
            const head = node('thead');
            const headRow = node('tr');
            ['Command', 'User', 'PID', 'Runtime', 'GPU memory', 'Slurm', 'Copy'].forEach(label => headRow.append(node('th', '', label)));
            head.append(headRow);
            const body = node('tbody');
            for (const process of gpu.processes) {
                const row = node('tr');
                const command = node('td', 'command-cell', process.command || process.name);
                command.title = process.command || process.name;
                const slurm = process.slurm ? process.slurm.id + ' · ' + process.slurm.name + ' · ' + process.slurm.state : '—';
                const actions = node('td', 'copy-actions');
                actions.append(
                    button('PID', 'table-button', () => vscode.postMessage({ command: 'copyValue', kind: 'pid', host: server.host, uuid: gpu.uuid, pid: process.pid })),
                    button('Cmd', 'table-button', () => vscode.postMessage({ command: 'copyValue', kind: 'command', host: server.host, uuid: gpu.uuid, pid: process.pid }))
                );
                row.append(command, node('td', '', process.user), node('td', '', process.pid),
                    node('td', '', formatDuration(process.elapsedSeconds)), node('td', 'numeric', process.usedMemory),
                    node('td', 'slurm-cell', slurm), actions);
                body.append(row);
            }
            table.append(head, body);
            scroll.append(table);
            inspector.append(scroll);
            return inspector;
        }

        function renderHealth(server) {
            if (!server.health) return undefined;
            const health = node('div', 'host-health');
            const ramPercent = healthPercent(server.health.memoryUsedMiB, server.health.memoryTotalMiB);
            const diskPercent = healthPercent(server.health.diskUsedMiB, server.health.diskTotalMiB);
            [['Load', server.health.load1.toFixed(2)], ['RAM', Math.round(ramPercent) + '%'],
                ['Disk', Math.round(diskPercent) + '%'], ['Uptime', formatDuration(server.health.uptimeSeconds)],
                ['SSH', server.latencyMs + ' ms']].forEach(([label, value]) => {
                const item = node('span', 'health-item');
                item.append(node('small', '', label), node('strong', '', value));
                health.append(item);
            });
            return health;
        }

        function healthPercent(value, total) {
            return total > 0 ? value / total * 100 : 0;
        }

        function renderServer(server, gpus, settings) {
            const band = node('section', 'server-band' + (server.error ? ' offline' : ' online') + (server.stale ? ' stale' : ''));
            const header = node('header', 'server-header');
            const identity = node('div', 'server-title');
            const nameRow = node('div', 'server-name-row');
            nameRow.append(node('h2', '', server.metadata && server.metadata.alias || server.host));
            if (server.metadata && server.metadata.alias) nameRow.append(node('span', 'host-alias', server.host));
            if (server.metadata && server.metadata.group) nameRow.append(node('span', 'tag', server.metadata.group));
            if (server.duplicateOf) nameRow.append(node('span', 'tag duplicate', 'Same host as ' + server.duplicateOf));
            if (server.slurmAvailable) nameRow.append(node('span', 'tag', 'Slurm'));
            identity.append(nameRow, node('span', 'subtle', server.error ? 'Offline' : server.gpus.length + ' GPUs · ' + server.latencyMs + ' ms'));
            const actions = node('div', 'server-actions');
            actions.append(
                button(server.metadata && server.metadata.favorite ? 'Unfavorite' : 'Favorite', 'secondary-button compact-button',
                    () => vscode.postMessage({ command: 'toggleFavorite', host: server.host })),
                button('Organize', 'secondary-button compact-button', () => vscode.postMessage({ command: 'editServer', host: server.host })),
                button('Connect', 'secondary-button compact-button', () => vscode.postMessage({ command: 'connect', host: server.host }))
            );
            header.append(identity, actions);
            band.append(header);
            const health = settings.showHostHealth && renderHealth(server);
            if (health) band.append(health);
            if (server.error) {
                const error = node('div', 'server-error', server.error + (server.stale && server.lastSuccessAt
                    ? ' · Showing last snapshot from ' + new Date(server.lastSuccessAt).toLocaleTimeString() : ''));
                error.append(button('Retry', 'error-retry', () => vscode.postMessage({ command: 'refresh' })));
                band.append(error);
            }
            if (gpus.length) {
                const columnCount = Math.min(4, Math.max(1, gpus.length));
                const grid = node('div', 'gpu-matrix' + (settings.compactLayout ? ' compact gpu-count-' + columnCount : ''));
                gpus.forEach(gpu => grid.append(renderGpu(server, gpu, settings)));
                band.append(grid);
                const selected = settings.showProcesses && gpus.find(gpu => selectedGpuKey === server.host + ':' + gpu.uuid);
                if (selected) band.append(renderInspector(server, selected));
            } else if (!server.error) {
                band.append(node('div', 'empty-state compact-empty', 'No NVIDIA GPUs found'));
            }
            return band;
        }

        function renderFleet() {
            if (!currentMessage) return;
            content.replaceChildren();
            const fragment = document.createDocumentFragment();
            let visibleGpuCount = 0;
            for (const server of currentMessage.data) {
                if (statusFilter.value === 'offline' && !server.error) continue;
                if (server.error && statusFilter.value !== 'all' && statusFilter.value !== 'offline') continue;
                const gpus = sortedGpus(server.gpus.filter(gpu => matchesGpu(server, gpu)));
                const serverQuery = searchInput.value.trim().toLowerCase();
                const serverMatch = !serverQuery || [server.host, server.metadata && server.metadata.alias,
                    server.metadata && server.metadata.group].filter(Boolean).join(' ').toLowerCase().includes(serverQuery);
                if (!gpus.length && !(server.error && serverMatch)) continue;
                visibleGpuCount += gpus.length;
                fragment.append(renderServer(server, gpus, currentMessage.settings));
            }
            if (!fragment.childNodes.length) {
                content.append(node('div', 'empty-state', 'No GPUs match the current filters.'));
            } else {
                content.append(fragment);
            }
            refreshState.textContent = 'Updated ' + new Date(currentMessage.summary.updatedAt).toLocaleTimeString() +
                ' · ' + visibleGpuCount + ' shown';
        }

        function render(message) {
            currentMessage = message;
            pageTitle.textContent = message.title;
            renderSummary(message.summary);
            renderUsers(message.users || []);
            renderFleet();
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'loading') {
                refreshState.textContent = 'Refreshing…';
                document.getElementById('refresh-button').disabled = true;
            } else if (message.type === 'update') {
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
        body { margin: 0; padding: 14px 16px 28px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
        button, input, select { font: inherit; }
        button { min-height: 28px; padding: 4px 10px; border: 1px solid transparent; border-radius: 4px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
        button:disabled { cursor: wait; opacity: .65; }
        .secondary-button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
        .secondary-button:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .compact-button { min-height: 24px; padding: 2px 7px; font-size: 10px; }
        .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 42px; border-bottom: 1px solid var(--vscode-widget-border); }
        .toolbar h1 { margin: 0 0 2px; font-size: 14px; }
        .toolbar-actions, .server-actions, .gpu-actions, .copy-actions { display: flex; align-items: center; gap: 6px; }
        .subtle { color: var(--vscode-descriptionForeground); font-size: 10px; }
        .block { display: block; margin-top: 2px; }
        .summary-strip { display: grid; grid-template-columns: repeat(6, minmax(90px, 1fr)); border-bottom: 1px solid var(--vscode-widget-border); }
        .summary-item { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 9px 12px; border-right: 1px solid var(--vscode-widget-border); }
        .summary-item:last-child { border-right: 0; }
        .summary-value { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .summary-label, .filter-label { color: var(--vscode-descriptionForeground); font-size: 9px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
        .available-summary .summary-value { color: var(--vscode-testing-iconPassed); }
        .fleet-controls { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 170px; gap: 7px; padding: 10px 0 7px; }
        input, select { min-height: 29px; padding: 4px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; color: var(--vscode-input-foreground, var(--vscode-foreground)); background: var(--vscode-input-background); }
        .user-filters { display: flex; align-items: center; gap: 5px; overflow-x: auto; padding: 0 0 10px; scrollbar-width: thin; }
        .filter-label { margin-right: 4px; white-space: nowrap; }
        .user-chip { min-height: 23px; padding: 2px 7px; color: var(--vscode-foreground); background: var(--vscode-badge-background); font-size: 10px; white-space: nowrap; }
        .user-chip.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
        #content { display: grid; gap: 9px; }
        .server-band { min-width: 0; overflow: hidden; border: 1px solid var(--vscode-widget-border); border-left: 3px solid var(--vscode-errorForeground); border-radius: 5px; background: var(--vscode-sideBar-background); }
        .server-band.online { border-left-color: var(--vscode-testing-iconPassed); }
        .server-band.stale { border-left-color: var(--vscode-editorWarning-foreground); }
        .server-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 11px; border-bottom: 1px solid var(--vscode-widget-border); }
        .server-title { min-width: 0; }
        .server-name-row { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
        .server-name-row h2 { overflow: hidden; margin: 0; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .host-alias { color: var(--vscode-descriptionForeground); font-size: 10px; }
        .tag { flex: 0 0 auto; padding: 1px 5px; border-radius: 8px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; }
        .tag.duplicate { color: var(--vscode-editorWarning-foreground); }
        .host-health { display: flex; align-items: center; gap: 12px; overflow-x: auto; padding: 6px 11px; border-bottom: 1px solid var(--vscode-widget-border); }
        .health-item { display: flex; align-items: baseline; gap: 4px; white-space: nowrap; }
        .health-item small { color: var(--vscode-descriptionForeground); font-size: 9px; text-transform: uppercase; }
        .health-item strong { font-size: 10px; }
        .server-error { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 11px; color: var(--vscode-errorForeground); background: color-mix(in srgb, var(--vscode-errorForeground) 8%, transparent); font-size: 10px; }
        .error-retry { min-height: 22px; padding: 2px 7px; }
        .gpu-matrix { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 7px; padding: 8px; align-items: start; }
        .gpu-matrix.compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .gpu-matrix.compact.gpu-count-1 { grid-template-columns: minmax(0, 1fr); }
        .gpu-matrix.compact.gpu-count-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .gpu-matrix.compact.gpu-count-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .gpu-tile { min-width: 0; overflow: hidden; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-editor-background); }
        .gpu-tile.available { border-left: 2px solid var(--vscode-testing-iconPassed); }
        .gpu-tile.has-warning { border-color: var(--vscode-editorWarning-foreground); }
        .gpu-tile.selected { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
        .gpu-main { display: block; width: 100%; min-height: 112px; padding: 8px; border: 0; border-radius: 0; color: var(--vscode-foreground); background: transparent; text-align: left; }
        .gpu-main:hover { background: var(--vscode-list-hoverBackground); }
        .gpu-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin-bottom: 7px; }
        .gpu-identity { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .gpu-index { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 9px; font-weight: 600; }
        .gpu-name { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .availability { flex: 0 0 auto; padding: 1px 5px; border-radius: 8px; font-size: 9px; }
        .availability.available { color: var(--vscode-testing-iconPassed); background: color-mix(in srgb, var(--vscode-testing-iconPassed) 12%, transparent); }
        .availability.busy { color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); }
        .memory-row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 9px; }
        .memory-row span:last-child { color: var(--vscode-foreground); white-space: nowrap; }
        .progress-track { height: 5px; overflow: hidden; border-radius: 3px; background: var(--vscode-input-background); }
        .progress-fill { height: 100%; background: var(--vscode-charts-blue); }
        .warning-fill { background: var(--vscode-editorWarning-foreground); }
        .warning-text, .metric.warning strong { color: var(--vscode-editorWarning-foreground); }
        .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin-top: 7px; }
        .metric { display: flex; flex-direction: column; min-width: 0; padding: 3px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); font-size: 9px; }
        .metric span { color: var(--vscode-descriptionForeground); }
        .metric strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .process-count { margin-top: 7px; color: var(--vscode-descriptionForeground); font-size: 9px; }
        .gpu-actions { padding: 5px 7px; border-top: 1px solid var(--vscode-widget-border); }
        .action-button { min-height: 23px; padding: 2px 7px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-size: 9px; }
        .primary-action { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
        .process-inspector { margin: 0 8px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-editor-background); }
        .inspector-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 9px; border-bottom: 1px solid var(--vscode-widget-border); }
        .inspector-empty, .empty-state { padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; }
        .process-scroll { max-height: 260px; overflow: auto; }
        .process-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
        .process-table th, .process-table td { overflow: hidden; padding: 5px 7px; border-bottom: 1px solid var(--vscode-widget-border); text-align: left; text-overflow: ellipsis; white-space: nowrap; }
        .process-table th { position: sticky; top: 0; z-index: 1; color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); font-size: 9px; text-transform: uppercase; }
        .process-table th:first-child { width: 34%; }
        .process-table th:nth-child(6) { width: 18%; }
        .process-table th:last-child { width: 82px; }
        .numeric { text-align: right !important; }
        .table-button { min-height: 20px; padding: 1px 5px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font-size: 9px; }
        .compact-empty { padding: 12px; }
        @media (max-width: 980px) {
            .summary-strip { grid-template-columns: repeat(3, minmax(90px, 1fr)); }
            .summary-item:nth-child(3) { border-right: 0; }
            .fleet-controls { grid-template-columns: 1fr 130px; }
            #sort-select { grid-column: 1 / -1; }
            .server-header { align-items: flex-start; }
            .server-actions { flex-wrap: wrap; justify-content: flex-end; }
            .gpu-matrix.compact[class*="gpu-count-"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 650px) {
            body { padding: 10px; }
            .toolbar { align-items: flex-start; }
            .summary-strip { grid-template-columns: repeat(2, minmax(90px, 1fr)); }
            .summary-item:nth-child(3) { border-right: 1px solid var(--vscode-widget-border); }
            .summary-item:nth-child(even) { border-right: 0; }
            .fleet-controls { grid-template-columns: 1fr; }
            #sort-select { grid-column: auto; }
            .server-header { display: grid; }
            .server-actions { justify-content: flex-start; }
            .gpu-matrix, .gpu-matrix.compact[class*="gpu-count-"] { grid-template-columns: 1fr; }
            .process-table th:first-child { width: 26%; }
        }
    `;
}
