import en = require('./locales/en.json');
import zhCN = require('./locales/zh-CN.json');
import lineIcons = require('./lineIcons.json');
import { getDialogCss, getPreferencesScript } from './preferencesView';
import { getAssistantCss, getAssistantScript } from './assistantView';

const dashboardTranslations = { en, 'zh-CN': zhCN };

export function getDashboardTranslation(language: 'en' | 'zh-CN', key: keyof typeof en): string {
    return dashboardTranslations[language][key];
}

export function getDashboardScript(): string {
    return `
        const vscode = acquireVsCodeApi();
        const content = document.getElementById('content');
        const detailSidebar = document.getElementById('gpu-details');
        const summaryRoot = document.getElementById('summary');
        const usersRoot = document.getElementById('user-filters');
        const refreshState = document.getElementById('refresh-state');
        const pageTitle = document.getElementById('page-title');
        const searchInput = document.getElementById('search-input');
        const statusFilter = document.getElementById('status-filter');
        const sortSelect = document.getElementById('sort-select');
        const refreshMode = document.getElementById('refresh-mode');
        const refreshButton = document.getElementById('refresh-button');
        const settingsButton = document.getElementById('settings-button');
        const assistantButton = document.getElementById('assistant-button');
        const minMemory = document.getElementById('min-memory');
        const minGpus = document.getElementById('min-gpus');
        const myTasksButton = document.getElementById('my-tasks-button');
        const resetFiltersButton = document.getElementById('reset-filters-button');
        const savedState = vscode.getState ? vscode.getState() || {} : {};
        let currentMessage;
        let selectedGpuKey = savedState.selectedGpuKey;
        let selectedUser = savedState.selectedUser || '';
        let offlineExpanded = Boolean(savedState.offlineExpanded);
        let language = 'en';
        let refreshStatus = { state: 'idle', completed: 0, total: 0 };
        let visibleGpuCount = 0;
        const selectedTasks = new Map();
        const taskEvidence = new Map();
        const taskProgress = new Map();
        const taskText = (en, zh) => language === 'zh-CN' ? zh : en;

        const translations = ${JSON.stringify(dashboardTranslations)};
        const icons = ${JSON.stringify(lineIcons)};
        const returnFocus = new WeakMap();

        function icon(name) {
            const element = document.createElement('span');
            element.className = 'icon';
            element.setAttribute('aria-hidden', 'true');
            element.innerHTML = icons[name] || '';
            return element;
        }
        function openDialog(dialog) {
            returnFocus.set(dialog, document.activeElement);
            dialog.onclose = () => { const previous = returnFocus.get(dialog); if (previous && previous.isConnected) previous.focus(); };
            if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
        }
        function closeDialog(dialog) {
            if (dialog.close) dialog.close();
            else { dialog.removeAttribute('open'); dialog.dispatchEvent(new Event('close')); }
        }

        function t(key) {
            return translations[language][key] || translations.en[key] || key;
        }

        function translateReasons(reasons) {
            if (language !== 'zh-CN') return reasons;
            return reasons.map(reason => {
                const processMatch = reason.match(/^([0-9]+) compute process(?:es)?$/);
                if (processMatch) return processMatch[1] + ' ' + t(processMatch[1] === '1' ? 'processReason' : 'processReasons');
                const memoryMatch = reason.match(/^([0-9]+) MiB memory used$/);
                if (memoryMatch) return memoryMatch[1] + ' ' + t('memoryUsedReason');
                const utilizationMatch = reason.match(/^([0-9]+)% utilization$/);
                if (utilizationMatch) return utilizationMatch[1] + '% ' + t('utilizationReason');
                return reason;
            });
        }

        function setOptionLabel(select, value, label) {
            const option = select.querySelector('option[value="' + value + '"]');
            if (option) option.textContent = label;
        }

        function applyStaticLanguage() {
            document.documentElement.lang = language;
            settingsButton.replaceChildren(icon('settings-2'), document.createTextNode(t('settings')));
            assistantButton.replaceChildren(icon('sparkles'), document.createTextNode(t('assistant')));
            refreshButton.replaceChildren(icon('refresh-cw'), document.createTextNode(t('refresh')));
            document.getElementById('min-memory-label').textContent = t('minFreeMemory');
            document.getElementById('min-gpus-label').textContent = t('matchingGpus');
            myTasksButton.replaceChildren(icon('user'), document.createTextNode(t('myTasks')));
            myTasksButton.title=currentMessage?.preferences?.researchUser?taskText('Filter by your configured username','按设置中的用户名筛选'):taskText('Set your remote username in Settings','在设置中填写远程用户名');
            myTasksButton.setAttribute('aria-pressed', String(Boolean(currentMessage && currentMessage.preferences && currentMessage.preferences.researchUser && selectedUser === currentMessage.preferences.researchUser)));
            resetFiltersButton.replaceChildren(icon('rotate-ccw'), document.createTextNode(t('resetFilters')));
            searchInput.placeholder = t('search');
            searchInput.setAttribute('aria-label', t('search'));
            setOptionLabel(statusFilter, 'all', t('allGpus'));
            setOptionLabel(statusFilter, 'available', t('available'));
            setOptionLabel(statusFilter, 'busy', t('busy'));
            setOptionLabel(statusFilter, 'warning', t('warning'));
            setOptionLabel(statusFilter, 'offline', t('offline'));
            setOptionLabel(sortSelect, 'configured', t('configuredOrder'));
            setOptionLabel(sortSelect, 'freeMemory', t('mostFreeMemory'));
            setOptionLabel(sortSelect, 'utilization', t('lowestUtilization'));
            setOptionLabel(sortSelect, 'temperature', t('lowestTemperature'));
        }

        function showRefreshState(state, completed, total) {
            refreshStatus = { state, completed, total };
            const active = state === 'refreshing' || state === 'queued';
            refreshButton.classList.toggle('refreshing', active);
            refreshButton.setAttribute('aria-busy', String(active));
            if (!currentMessage && active) {
                content.replaceChildren(node('div', 'empty-state loading-state', t('loadingServers')));
            }
            if (state === 'queued') {
                refreshState.textContent = t('refreshQueued');
            } else if (state === 'refreshing') {
                const progressText = total ? ' ' + completed + '/' + total : '';
                refreshState.textContent = t('refreshing') + progressText;
            } else if (currentMessage) {
                refreshState.textContent = t('updated') + ' ' + new Date(currentMessage.summary.updatedAt).toLocaleTimeString();
            }
            const automatic=currentMessage?.refresh?.automatic??currentMessage?.preferences?.autoRefresh??true;
            const interval=currentMessage?.refresh?.intervalSeconds||currentMessage?.preferences?.refreshInterval||5;
            refreshMode.textContent=automatic?taskText('Auto · ','自动 · ')+interval+taskText('s',' 秒'):taskText('Manual refresh','手动刷新');
            refreshMode.dataset.automatic=String(automatic);
            refreshMode.title=taskText('Refresh settings. Interval after each completed round; failed hosts back off. Hidden panels pause by default.','刷新设置：每轮完成后间隔刷新；失败主机延迟重试，面板隐藏时默认暂停。');
        }

        refreshButton.addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
        settingsButton.addEventListener('click', () => window.dispatchEvent(new Event('openPreferences')));
        assistantButton.addEventListener('click', () => window.dispatchEvent(new Event('openAssistant')));
        refreshMode.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('openPreferences',{detail:'refresh'})));
        searchInput.addEventListener('input', () => renderFleet());
        statusFilter.addEventListener('change', () => renderFleet());
        sortSelect.addEventListener('change', () => renderFleet());
        minMemory.addEventListener('input', () => renderFleet());
        minGpus.addEventListener('input', () => renderFleet());
        searchInput.value = typeof savedState.search === 'string' ? savedState.search : '';
        statusFilter.value = savedState.status || 'all';
        sortSelect.value = savedState.sort || 'configured';
        minMemory.value = Number(savedState.minMemory) || 0;
        minGpus.value = Math.max(1, Number(savedState.minGpus) || 1);
        myTasksButton.addEventListener('click', () => {
            const user = currentMessage && currentMessage.preferences && currentMessage.preferences.researchUser;
            if (!user) {
                window.dispatchEvent(new CustomEvent('openPreferences', { detail: 'servers' }));
                return;
            }
            selectedUser = selectedUser === user ? '' : user;
            renderUsers(currentMessage.users || []);
            renderFleet();
        });
        resetFiltersButton.addEventListener('click', () => {
            searchInput.value = ''; statusFilter.value = 'all'; sortSelect.value = 'configured';
            minMemory.value = '0'; minGpus.value = '1'; selectedUser = '';
            if (currentMessage) renderUsers(currentMessage.users || []);
            renderFleet();
        });

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
            const iconNames = { [t('openTerminal')]: 'terminal', [t('copyCuda')]: 'copy', [t('connect')]: 'server' };
            if (iconNames[label]) element.prepend(icon(iconNames[label]));
            element.onclick = event => {
                event.stopPropagation();
                handler();
            };
            return element;
        }

        // Retain mounted nodes so background updates preserve focus, selection,
        // scroll containers, and progress transitions. Only changed values mutate.
        function patchChildren(parent, desired) {
            const previous = Array.from(parent.childNodes);
            const used = new Set();
            const keyed = new Map(previous.filter(child => child.nodeType === 1 && child.dataset.key)
                .map(child => [child.dataset.key, child]));
            let cursor = parent.firstChild;
            for (const next of Array.from(desired.childNodes)) {
                const key = next.nodeType === 1 && next.dataset.key;
                const current = key ? keyed.get(key) : previous.find(child => !used.has(child) &&
                    !(child.nodeType === 1 && child.dataset.key) && child.nodeType === next.nodeType && child.nodeName === next.nodeName);
                let mounted = next;
                if (current && current.nodeName === next.nodeName) {
                    mounted = current;
                    used.add(current);
                    if (next.nodeType !== 1) {
                        if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
                    } else {
                        for (const attribute of Array.from(current.attributes)) {
                            if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
                        }
                        for (const attribute of Array.from(next.attributes)) {
                            if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
                        }
                        current.onclick = next.onclick;
                        current.ontoggle = next.ontoggle;
                        patchChildren(current, next);
                    }
                }
                if (mounted !== cursor) parent.insertBefore(mounted, cursor);
                cursor = mounted.nextSibling;
            }
            for (const child of previous) {
                if (!used.has(child)) child.remove();
            }
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
            return days ? days + t('dayShort') + ' ' + hours + t('hourShort')
                : hours ? hours + t('hourShort') + ' ' + minutes + t('minuteShort')
                    : minutes + t('minuteShort');
        }

        function progress(value, warning, label) {
            const track = node('div', 'progress-track');
            track.setAttribute('role', 'progressbar');
            track.setAttribute('aria-label', label || t('memory'));
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

        function visualMeter(value, className, label) {
            const level = Math.min(100, Math.max(0, Number(value) || 0));
            const track = node('span', className || 'visual-meter');
            const fill = node('span', 'visual-meter-fill');
            fill.style.width = level + '%';
            track.setAttribute('role', 'progressbar');
            track.setAttribute('aria-label', label || t('util'));
            track.setAttribute('aria-valuenow', String(Math.round(level)));
            track.setAttribute('aria-valuemin', '0');
            track.setAttribute('aria-valuemax', '100');
            track.append(fill);
            return track;
        }

        function renderSummary(summary, settings) {
            const serverPercent = percent(summary.serversOnline, summary.serversTotal);
            const availablePercent = percent(summary.gpusAvailable, summary.gpusTotal);
            const powerPercent = percent(summary.powerDraw, summary.powerLimit);
            const items = [
                { label: t('available')+' GPU', value: summary.gpusAvailable + ' / ' + summary.gpusTotal,
                    detail: Math.round(availablePercent)+'% · '+t('matchesRules'),tone:'good',filter:'available' },
                { label: t('util'), value:summary.utilizationPercent+'%',detail:taskText('GPU average','GPU 平均利用率'),level:summary.utilizationPercent,tone:'neutral' },
                { label: t('memory'), value: summary.memoryPercent + '%',
                    detail: formatMemory(summary.memoryUsed) + ' / ' + formatMemory(summary.memoryTotal),
                    level: summary.memoryPercent, tone: summary.memoryPercent >= settings.memoryWarningThreshold ? 'warning' : 'neutral' },
                { label: t('power'), value: formatPower(summary.powerDraw),
                    detail: Math.round(powerPercent) + '% ' + t('ofLimit'), level: powerPercent,
                    tone: powerPercent >= settings.powerWarningThreshold ? 'warning' : 'neutral' },
                { label:t('servers'),value:summary.serversOnline+' / '+summary.serversTotal,detail:t('online'),tone:serverPercent<100?'caution':'neutral',filter:serverPercent<100?'offline':undefined },
                { label:t('warnings'),value:String(summary.warnings),detail:taskText('GPUs above thresholds','超过告警阈值的 GPU'),tone:summary.warnings?'warning':'neutral',filter:summary.warnings?'warning':undefined }
            ];
            const fragment = document.createDocumentFragment();
            for (const summary of items) {
                const className='summary-item summary-'+summary.tone+(summary.filter?' summary-filter':'');
                const item=summary.filter?button('',className,()=>{statusFilter.value=statusFilter.value===summary.filter?'all':summary.filter;renderFleet();}):node('div',className);
                if(summary.filter){item.dataset.filter=summary.filter;item.setAttribute('aria-pressed',String(statusFilter.value===summary.filter));item.title=taskText('Toggle filter: ','切换筛选：')+summary.label;}
                item.append(
                    node('span', 'summary-label', summary.label),
                    node('strong', 'summary-value', summary.value),
                    node('span', 'summary-detail', summary.detail)
                );
                if(summary.level!==undefined)item.append(visualMeter(summary.level, 'visual-meter summary-meter', summary.label));
                fragment.append(item);
            }
            patchChildren(summaryRoot, fragment);
        }

        function renderUsers(users) {
            const fragment = document.createDocumentFragment();
            if (!users.length) {
                usersRoot.hidden = true;
                return;
            }
            usersRoot.hidden = false;
            fragment.append(node('span', 'filter-label', t('activeUsers')));
            const all = button(t('all'), selectedUser ? 'user-chip' : 'user-chip active', () => {
                selectedUser = '';
                renderUsers(currentMessage.users);
                renderFleet();
            });
            all.dataset.key = 'all-users';
            all.setAttribute('aria-pressed',String(!selectedUser));
            fragment.append(all);
            for (const user of users) {
                const label = user.user + ' · ' + user.gpuCount + ' GPU · ' + formatMemory(user.memoryMiB);
                const chip = button(label, selectedUser === user.user ? 'user-chip active' : 'user-chip', () => {
                    selectedUser = selectedUser === user.user ? '' : user.user;
                    renderUsers(currentMessage.users);
                    renderFleet();
                });
                chip.dataset.key = 'user:' + user.user;
                chip.setAttribute('aria-pressed', String(selectedUser === user.user));
                fragment.append(chip);
            }
            patchChildren(usersRoot, fragment);
        }

        function matchesGpu(server, gpu) {
            const query = searchInput.value.trim().toLowerCase();
            const processes = gpu.processes || [];
            if (number(gpu.memory.free) < Math.max(0, Number(minMemory.value) || 0) * 1024) return false;
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

        function metric(label, value, warning, level) {
            if (!value || value === 'N/A') return undefined;
            const item = node('div', warning ? 'metric warning' : 'metric');
            const heading = node('span', 'metric-heading');
            heading.append(node('span', '', label), node('strong', '', value));
            item.append(heading);
            if (level !== undefined) item.append(visualMeter(level, 'visual-meter metric-meter', label));
            return item;
        }

        function renderGpu(server, gpu, settings) {
            const key = server.host + ':' + gpu.uuid;
            const memoryPercent = percent(gpu.memory.used, gpu.memory.total);
            const warning = hasWarning(gpu, settings);
            const selected = selectedGpuKey === key;
            const card = node('article', 'gpu-tile' + (warning ? ' has-warning' : '') +
                (selected ? ' selected' : '') + (gpu.availability.available ? ' available' : ' busy'));
            card.dataset.key = key;

            const main = button('', 'gpu-main', () => {
                if (settings.showProcesses) {
                    if(selected)closeInspector();
                    else {selectedGpuKey=key;renderFleet();detailSidebar.querySelector('button')?.focus({preventScroll:true});}
                }
            }, settings.showProcesses ? t('inspectGpu') : gpu.name);
            main.setAttribute('aria-expanded', String(Boolean(selected && settings.showProcesses)));
            main.setAttribute('aria-controls','gpu-details');
            const heading = node('div', 'gpu-heading');
            const identity = node('div', 'gpu-identity');
            identity.append(node('span', 'gpu-index', 'GPU ' + gpu.index), node('strong', 'gpu-name', gpu.name));
            const state = node('span', gpu.availability.available ? 'availability available' : 'availability busy',
                gpu.availability.available ? t('available') : t('busy'));
            state.title = gpu.availability.available ? t('matchesRules') : translateReasons(gpu.availability.reasons).join(' · ');
            heading.append(identity, state);
            main.append(heading);

            const memoryRow = node('div', 'memory-row');
            memoryRow.title = gpu.memory.used + ' / ' + gpu.memory.total;
            memoryRow.append(node('span', '', t('memory')), node('span', memoryPercent >= settings.memoryWarningThreshold ? 'warning-text' : '',
                formatMemory(gpu.memory.used) + ' / ' + formatMemory(gpu.memory.total)));
            main.append(memoryRow, progress(memoryPercent, memoryPercent >= settings.memoryWarningThreshold));

            const metrics = node('div', 'metrics');
            const values = [];
            if (settings.showUtilization) values.push(metric(t('util'), gpu.utilization.gpu, false,
                number(gpu.utilization.gpu)));
            if (settings.showTemperature) values.push(metric(t('temp'), gpu.temperature.gpu.replace(' C', '°C'),
                number(gpu.temperature.gpu) >= settings.temperatureWarningThreshold));
            if (settings.showPower && gpu.power.draw !== 'N/A') values.push(metric(t('power'), gpu.power.draw,
                percent(gpu.power.draw, gpu.power.limit) >= settings.powerWarningThreshold));
            if (settings.showFanSpeed) values.push(metric(t('fan'), gpu.fanSpeed, false));
            values.filter(Boolean).forEach(value => metrics.append(value));
            if (metrics.childElementCount) main.append(metrics);
            if (settings.showProcesses) {
                const users = Array.from(new Set(gpu.processes.map(process => process.user))).join(', ');
                const processLine = node('div', 'process-count', formatMemory(gpu.memory.free) + ' ' + t('free') + ' · ' +
                    (users || gpu.processes.length + ' ' + t('processesShort')));
                processLine.title = users;
                main.append(processLine);
            }
            card.append(main);

            const actions = node('div', 'gpu-actions');
            actions.append(
                button(t('openTerminal'), gpu.availability.available ? 'action-button primary-action' : 'action-button',
                    () => vscode.postMessage({ command: 'openGpuTerminal', host: server.host, uuid: gpu.uuid })),
                button(t('copyCuda'), 'action-button',
                    () => vscode.postMessage({ command: 'copyValue', kind: 'cuda', host: server.host, uuid: gpu.uuid }))
            );
            card.append(actions);
            return card;
        }

        function closeInspector(){
            const trigger=Array.from(content.querySelectorAll('.gpu-tile')).find(card=>card.dataset.key===selectedGpuKey)?.querySelector('.gpu-main');
            selectedGpuKey=undefined;renderFleet();(trigger||searchInput).focus({preventScroll:true});
        }
        document.addEventListener('keydown',event=>{
            if(event.key==='Escape'&&!detailSidebar.hidden&&!document.querySelector('dialog[open]')){event.preventDefault();closeInspector();}
        });
        function renderInspector(server, gpu) {
            const key=server.host+':'+gpu.uuid;
            const inspector=node('section','process-inspector');inspector.dataset.key='inspector:'+key;
            const header=node('header','inspector-header');
            const title=node('div');title.id='gpu-details-title';title.append(node('strong','',(server.metadata?.alias||server.host)+' · GPU '+gpu.index),node('span','subtle block',gpu.name+' · '+gpu.memory.used+' / '+gpu.memory.total+' · '+gpu.utilization.gpu));
            const close=button('','secondary-button compact-button',closeInspector,t('close')+' (Esc)');close.setAttribute('aria-label',t('close'));close.append(icon('x'));
            header.append(title,close);inspector.append(header);
            const actions=node('div','task-primary-actions');
            const ask=(process)=>window.dispatchEvent(new CustomEvent('openAssistant',{detail:{host:server.host,uuid:gpu.uuid,pid:process?.pid,question:process?taskText('Identify this GPU task and inspect its launcher and progress.','查一下这个 GPU 任务的训练入口和进度。'):taskText('What is running on this GPU?','这张 GPU 在运行什么任务？')}}));
            actions.append(button(taskText('Ask AI','问 AI'),'secondary-button compact-button',()=>ask(selectedTasks.get(key))),button(taskText('Notify when free','释放时提醒我'),'secondary-button compact-button',()=>{vscode.postMessage({command:'watchGpu',host:server.host,uuid:gpu.uuid});window.dispatchEvent(new CustomEvent('openAssistant',{detail:{host:server.host,uuid:gpu.uuid}}));}));inspector.append(actions);
            if(!gpu.processes.length&&!selectedTasks.has(key)){inspector.append(node('p','subtle',t('noProcesses')));return inspector;}
            const layout=node('div','task-inspector-layout');
            const list=node('div','process-scroll task-list');list.setAttribute('role','group');list.setAttribute('aria-label',taskText('GPU processes','GPU 进程'));
            if(!selectedTasks.has(key)&&gpu.processes.length)selectedTasks.set(key,{...gpu.processes[0]});
            const selected=selectedTasks.get(key);
            for(const process of gpu.processes){
                const row=button('','task-row',()=>{selectedTasks.set(key,{...process});renderFleet();});row.dataset.key=process.pid+':'+(process.startIdentity||'');row.setAttribute('aria-pressed',String(selected?.pid===process.pid&&(!selected.startIdentity||selected.startIdentity===process.startIdentity)));
                const command=process.command||process.name;
                row.append(node('strong','task-owner',process.user+' · PID '+process.pid),node('span','task-entrypoint',command),node('span','subtle',formatDuration(process.elapsedSeconds)+' · '+process.usedMemory));row.title=command;list.append(row);
            }
            const details=node('section','task-details');details.dataset.key='selected-task';
            if(selected){
                const live=gpu.processes.find(p=>p.pid===selected.pid&&(selected.startIdentity?p.startIdentity===selected.startIdentity:p.elapsedSeconds>=selected.elapsedSeconds));
                if(!live)details.append(node('p','task-ended',taskText('This selected process is no longer in the current sample. Exit status is unknown.','选中进程已不在本次采样中；退出状态未知。')));
                const process=live||selected;
                details.append(node('strong','',process.user+' · PID '+process.pid),node('span','subtle block',taskText('Runtime: ','已运行：')+formatDuration(process.elapsedSeconds)+' · '+taskText('GPU memory: ','GPU 显存：')+process.usedMemory));
                if(process.slurm)details.append(node('p','subtle','Slurm '+process.slurm.id+' · '+process.slurm.name+' · '+process.slurm.state));
                details.append(node('pre','task-command',process.command||process.name));
                const controls=node('div','dialog-actions');
                controls.append(button(taskText('Trace task source','查询任务来源'),'secondary-button compact-button',()=>{taskEvidence.set(key+':'+process.pid,{loading:true});vscode.postMessage({command:'inspectTask',host:server.host,uuid:gpu.uuid,pid:process.pid});renderFleet();}),button(t('cmd'),'secondary-button compact-button',()=>vscode.postMessage({command:'copyAiText',text:process.command||process.name})),button('PID','secondary-button compact-button',()=>vscode.postMessage({command:'copyAiText',text:process.pid})),button(taskText('Ask AI about task','问 AI 分析任务'),'secondary-button compact-button',()=>ask(process)));
                controls.firstElementChild.disabled=!live;inspector.append(node('span','subtle task-sample-time',taskText('GPU sample: ','GPU 采样：')+new Date(server.lastSuccessAt||server.collectedAt).toLocaleTimeString()));details.append(controls);
                const evidence=taskEvidence.get(key+':'+process.pid);
                if(evidence){
                    if(evidence.loading)details.append(node('p','subtle',taskText('Tracing parent processes…','正在追查父进程…')));
                    else if(evidence.error)details.append(node('p','task-ended',evidence.error));
                    else {
                        details.append(node('p','subtle',taskText('Task evidence: ','任务查询：')+new Date(evidence.collectedAt).toLocaleTimeString()));
                        const chain=node('div','task-parent-chain');
                        for(const parent of evidence.chain||[]) {const item=node('div','task-parent');item.append(node('strong','',parent.user+' · PID '+parent.pid+' → '+parent.ppid),node('code','block',parent.command),node('span','subtle block',parent.cwd||''));chain.append(item);}
                        if(!chain.childNodes.length)chain.append(node('p','subtle',taskText('No accessible process evidence. The task may have exited or permission is missing.','没有可读取的进程信息：任务可能已退出或权限不足。')));
                        details.append(chain);
                        const paths=[...new Set((evidence.chain||[]).flatMap(p=>p.logs||[]))];
                        for(const path of paths) {
                            const log=node('div','task-parent');log.append(node('strong','',taskText('Task log','任务日志')),node('code','block',path));
                            const progress=taskProgress.get(server.host+':'+path);
                            if(progress){
                                log.append(node('span','subtle block',taskText('Log updated: ','日志更新：')+new Date(progress.modifiedAt*1000).toLocaleString()),node('span','subtle block',taskText('Read at: ','已读取于：')+new Date(progress.collectedAt).toLocaleTimeString()+taskText(' · Interpretation in AI chat',' · 进度解读见 AI 对话')));
                            } else log.append(node('span','subtle block',taskText('Ask AI to inspect progress; it will request log authorization if needed.','问 AI 查询进度，需要读取日志时会在对话中请求授权。')));
                            details.append(log);
                        }
                    }
                }
            }
            layout.append(list,details);inspector.append(layout);return inspector;
        }

        function renderHealth(server) {
            if (!server.health) return undefined;
            const health = node('div', 'host-health');
            const ramPercent = healthPercent(server.health.memoryUsedMiB, server.health.memoryTotalMiB);
            const diskPercent = healthPercent(server.health.diskUsedMiB, server.health.diskTotalMiB);
            [{ label: t('load'), value: server.health.load1.toFixed(2) },
                { label: t('ram'), value: Math.round(ramPercent) + '%', level: ramPercent },
                { label: t('disk'), value: Math.round(diskPercent) + '%', level: diskPercent },
                { label: t('uptime'), value: formatDuration(server.health.uptimeSeconds) },
                { label: 'SSH', value: server.latencyMs + ' ms' }].forEach(healthMetric => {
                const warning = healthMetric.level !== undefined && healthMetric.level >= 85;
                const item = node('span', warning ? 'health-item warning' : 'health-item');
                const heading = node('span', 'health-heading');
                heading.append(node('small', '', healthMetric.label), node('strong', '', healthMetric.value));
                item.append(heading);
                if (healthMetric.level !== undefined) {
                    item.append(visualMeter(healthMetric.level, 'visual-meter health-meter', healthMetric.label));
                }
                health.append(item);
            });
            return health;
        }

        function healthPercent(value, total) {
            return total > 0 ? value / total * 100 : 0;
        }

        function renderServer(server, gpus, settings) {
            const band = node('section', 'server-band' + (server.error ? ' offline' : ' online') + (server.stale ? ' stale' : ''));
            band.dataset.key = server.host;
            const header = node('header', 'server-header');
            const identity = node('div', 'server-title');
            const nameRow = node('div', 'server-name-row');
            nameRow.append(node('h2', '', server.metadata && server.metadata.alias || server.host));
            if (server.metadata && server.metadata.alias) nameRow.append(node('span', 'host-alias', server.host));
            if (server.metadata && server.metadata.group) nameRow.append(node('span', 'tag', server.metadata.group));
            if (server.duplicateOf) nameRow.append(node('span', 'tag duplicate', t('sameHost') + ' ' + server.duplicateOf));
            if (server.slurmAvailable) nameRow.append(node('span', 'tag', 'Slurm'));
            nameRow.prepend(icon('server'));
            const available = server.gpus.filter(gpu => gpu.availability.available).length;
            identity.append(nameRow, node('span', 'subtle', server.error ? t('offline') :
                available + '/' + server.gpus.length + ' ' + t('available') + ' · ' + server.latencyMs + ' ms'));
            const actions = node('div', 'server-actions');
            actions.append(
                button(server.metadata && server.metadata.favorite ? t('unfavorite') : t('favorite'), 'secondary-button compact-button',
                    () => vscode.postMessage({ command: 'toggleFavorite', host: server.host })),
                button(t('organize'), 'secondary-button compact-button', () => vscode.postMessage({ command: 'editServer', host: server.host })),
                button(t('connect'), 'secondary-button compact-button', () => vscode.postMessage({ command: 'connect', host: server.host }))
            );
            header.append(identity, actions);
            band.append(header);
            const health = settings.showHostHealth && renderHealth(server);
            if (health) band.append(health);
            if (server.error) {
                const error = node('div', 'server-error', server.error + (server.stale && server.lastSuccessAt
                    ? ' · ' + t('showingSnapshot') + ' ' + new Date(server.lastSuccessAt).toLocaleTimeString() : ''));
                if(server.nextRetryAt)error.append(node('span','subtle',taskText('Auto retry ','自动重试 ')+new Date(server.nextRetryAt).toLocaleTimeString()));
                error.append(button(t('retry'), 'error-retry', () => vscode.postMessage({ command: 'refresh' })));
                band.append(error);
            }
            if (gpus.length) {
                const columnCount = Math.min(4, Math.max(1, gpus.length));
                const grid = node('div', 'gpu-matrix' + (settings.compactLayout ? ' compact gpu-count-' + columnCount : ''));
                gpus.forEach(gpu => grid.append(renderGpu(server, gpu, settings)));
                band.append(grid);
            } else if (!server.error) {
                band.append(node('div', 'empty-state compact-empty', server.hiddenGpuCount ? taskText('All GPUs are hidden in Settings → Servers.','GPU 已全部隐藏，可在设置 → 服务器中调整。') : t('noNvidia')));
            }
            return band;
        }

        function renderFleet() {
            if (!currentMessage) return;
            const fragment = document.createDocumentFragment();
            const onlineFragment = document.createDocumentFragment();
            const offlineFragment = document.createDocumentFragment();
            visibleGpuCount = 0;
            let onlineCount = 0;
            let offlineCount = 0;
            for (const server of currentMessage.data) {
                if (statusFilter.value === 'offline' && !server.error) continue;
                if (server.error && statusFilter.value !== 'all' && statusFilter.value !== 'offline') continue;
                const gpus = sortedGpus(server.gpus.filter(gpu => matchesGpu(server, gpu)));
                if (gpus.length < Math.max(1, Number(minGpus.value) || 1) && (Number(minMemory.value) > 0 || Number(minGpus.value) > 1)) continue;
                const serverQuery = searchInput.value.trim().toLowerCase();
                const serverMatch = !serverQuery || [server.host, server.metadata && server.metadata.alias,
                    server.metadata && server.metadata.group].filter(Boolean).join(' ').toLowerCase().includes(serverQuery);
                const emptyServer = !server.gpus.length && !selectedUser && statusFilter.value === 'all' && serverMatch;
                if (!gpus.length && !(server.error && serverMatch) && !emptyServer) continue;
                visibleGpuCount += gpus.length;
                if (server.error) {
                    offlineCount += 1;
                    offlineFragment.append(renderServer(server, gpus, currentMessage.settings));
                } else {
                    onlineCount += 1;
                    onlineFragment.append(renderServer(server, gpus, currentMessage.settings));
                }
            }
            if (!onlineCount && !offlineCount) {
                fragment.append(node('div', 'empty-state', t(currentMessage.data.length ? 'noMatches' : 'noServers')));
            } else {
                if (onlineCount) fragment.append(onlineFragment);
                if (offlineCount) {
                    const section = node('details', 'offline-section');
                    section.dataset.key = 'offline-servers';
                    const forceOpen = statusFilter.value === 'offline' || Boolean(searchInput.value.trim());
                    section.open = forceOpen || offlineExpanded;
                    section.ontoggle = event => {
                        if (!forceOpen) offlineExpanded = event.currentTarget.open;
                    };
                    const summary = node('summary', 'offline-summary');
                    summary.append(
                        node('span', 'offline-indicator'),
                        node('span', 'offline-summary-label', t('unavailableServers')),
                        node('span', 'offline-count', String(offlineCount))
                    );
                    const body = node('div', 'offline-list');
                    body.append(offlineFragment);
                    section.append(summary, body);
                    fragment.append(section);
                }
            }
            patchChildren(content, fragment);
            const filtered=Boolean(searchInput.value.trim()||statusFilter.value!=='all'||sortSelect.value!=='configured'||Number(minMemory.value)>0||Number(minGpus.value)>1||selectedUser);
            resetFiltersButton.hidden=!filtered;
            document.getElementById('filter-results').textContent=visibleGpuCount+' GPU';
            for(const item of summaryRoot.querySelectorAll('[data-filter]'))item.setAttribute('aria-pressed',String(statusFilter.value===item.dataset.filter));
            const details=document.createDocumentFragment();
            const selectedServer=currentMessage.settings.showProcesses&&currentMessage.data.find(server=>server.gpus.some(gpu=>selectedGpuKey===server.host+':'+gpu.uuid));
            if(selectedServer)details.append(renderInspector(selectedServer,selectedServer.gpus.find(gpu=>selectedGpuKey===selectedServer.host+':'+gpu.uuid)));
            else if(detailSidebar.contains(document.activeElement))searchInput.focus({preventScroll:true});
            const previousDetail=detailSidebar.firstElementChild?.dataset.key;
            patchChildren(detailSidebar,details);detailSidebar.hidden=!selectedServer;
            if(previousDetail!==detailSidebar.firstElementChild?.dataset.key)detailSidebar.scrollTop=0;
            document.getElementById('dashboard-layout').classList.toggle('details-open',Boolean(selectedServer));
            const myUser = currentMessage.preferences && currentMessage.preferences.researchUser;
            myTasksButton.setAttribute('aria-pressed', String(Boolean(myUser && selectedUser === myUser)));
            if (vscode.setState) vscode.setState({ search: searchInput.value, status: statusFilter.value, sort: sortSelect.value,
                minMemory: minMemory.value, minGpus: minGpus.value, selectedGpuKey, selectedUser, offlineExpanded });
            showRefreshState(refreshStatus.state, refreshStatus.completed, refreshStatus.total);
        }

        function render(message) {
            currentMessage = message;
            language = message.language === 'zh-CN' ? 'zh-CN' : 'en';
            applyStaticLanguage();
            pageTitle.replaceChildren(icon('fleet'), document.createTextNode(message.title));
            renderSummary(message.summary, message.settings);
            renderUsers(message.users || []);
            renderFleet();
            if (message.refresh && message.refresh.active) {
                showRefreshState('refreshing', message.refresh.completed, message.refresh.total);
            } else {
                showRefreshState('idle', 0, 0);
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (!message || typeof message !== 'object') return;
            if (message.type === 'loading' || message.type === 'refreshState') {
                language = message.language === 'zh-CN' ? 'zh-CN' : 'en';
                applyStaticLanguage();
                showRefreshState(message.state || 'refreshing', message.completed || 0, message.total || 0);
            } else if (message.type === 'taskProgress') {
                taskProgress.set(message.host+':'+message.path,message);renderFleet();
            } else if (message.type === 'taskEvidence') {
                taskEvidence.set(message.host+':'+message.uuid+':'+message.pid,message.evidence||{error:message.error});
                renderFleet();
            } else if (message.type === 'update') {
                render(message);
            }
        });
        applyStaticLanguage();
        refreshState.textContent = t('waiting');
        ${getPreferencesScript()}
        ${getAssistantScript()}
        vscode.postMessage({ command: 'ready' });
    `;
}

export function getDashboardCss(): string {
    return `
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        [hidden] { display:none !important; }
        body { margin: 0; padding: 14px 16px 28px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
        button, input, select, textarea { font: inherit; }
        button { min-height: 28px; padding: 4px 10px; border: 1px solid transparent; border-radius: 4px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
        button:disabled { cursor: wait; opacity: .65; }
        .icon { display: inline-flex; flex: 0 0 14px; width: 14px; height: 14px; align-items: center; justify-content: center; vertical-align: -2px; }
        .icon svg { width: 100%; height: 100%; stroke-width: 1.7; }
        #refresh-button.refreshing .icon { animation: refresh-spin 1.2s linear infinite; }
        .toolbar-actions button { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        @keyframes refresh-spin { to { transform: rotate(360deg); } }
        .secondary-button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
        .secondary-button:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .compact-button { min-height: 24px; padding: 2px 7px; font-size: 10px; }
        .toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:56px; margin-bottom:10px; }
        .toolbar h1 { display:flex; align-items:center; gap:8px; margin:0 0 5px; font-size:17px; font-weight:600; letter-spacing:-.3px; }
        .toolbar h1 .icon { width:22px; height:22px; flex-basis:22px; }
        .product-meta { display:flex; align-items:center; gap:10px; min-height:20px; }
        .meta-button { display:inline-flex; align-items:center; gap:5px; min-height:20px; padding:1px 6px; font-size:10px; background:transparent; color:var(--vscode-descriptionForeground); border:1px solid var(--vscode-widget-border); border-radius:10px; }
        .meta-button::before { content:''; width:5px; height:5px; border-radius:50%; background:var(--vscode-descriptionForeground); }
        .meta-button[data-automatic=true]::before { background:var(--vscode-testing-iconPassed); }
        .meta-button:hover { background:var(--vscode-list-hoverBackground); color:var(--vscode-foreground); }
        .toolbar-actions, .server-actions, .gpu-actions, .copy-actions { display: flex; align-items: center; gap: 6px; }
        .subtle { color: var(--vscode-descriptionForeground); font-size: 11px; }
        .block { display: block; margin-top: 2px; }
        .summary-strip { display:grid; grid-template-columns:1.25fr repeat(5,minmax(90px,1fr)); border:1px solid var(--vscode-widget-border); border-radius:6px; overflow:hidden; background:color-mix(in srgb,var(--vscode-sideBar-background) 35%,var(--vscode-editor-background)); }
        .summary-item { --meter-color:var(--vscode-charts-blue); display:flex; flex-direction:column; gap:5px; min-width:0; min-height:92px; padding:12px 14px; border:0; border-radius:0; border-right:1px solid var(--vscode-widget-border); background:transparent; color:var(--vscode-foreground); text-align:left; position:relative; }
        .summary-item:last-child { border-right: 0; }
        .summary-value { overflow:hidden; font-size:21px; font-weight:600; line-height:1.15; font-variant-numeric:tabular-nums; text-overflow:ellipsis; white-space:nowrap; }
        .summary-filter:hover { background:var(--vscode-list-hoverBackground); }
        .summary-filter[aria-pressed=true]::after { content:''; position:absolute; inset:auto 12px 0; height:2px; background:var(--vscode-focusBorder); }
        .summary-detail { overflow: hidden; color: var(--vscode-descriptionForeground); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .summary-label, .filter-label { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 500; }
        .summary-good { --meter-color: var(--vscode-testing-iconPassed); }
        .summary-good .summary-value { color: var(--vscode-testing-iconPassed); }
        .summary-warning, .summary-caution { --meter-color: var(--vscode-editorWarning-foreground); }
        .summary-warning .summary-value { color: var(--vscode-editorWarning-foreground); }
        .visual-meter { display: block; width: 100%; height: 3px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--vscode-foreground) 12%, transparent); }
        .visual-meter-fill { display: block; height: 100%; border-radius: inherit; background: var(--meter-color, var(--vscode-charts-blue)); transition: width .2s ease; }
        .summary-meter { margin-top:auto; height:2px; }
        .fleet-filter-panel { border:1px solid var(--vscode-widget-border); border-radius:6px; padding:10px; margin:12px 0; }
        .fleet-controls { display:grid; grid-template-columns:minmax(180px,1fr) 130px 160px; gap:8px; padding:0 0 9px; }
        .filter-secondary { display:flex; align-items:center; gap:10px 16px; flex-wrap:wrap; }
        .filter-actions { display:flex; align-items:center; gap:8px; margin-left:auto; }
        .filter-actions button { min-height:26px; padding:3px 7px; font-size:11px; }
        .filter-actions .subtle { white-space:nowrap; }
        input, select, textarea { min-height: 29px; padding: 4px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; color: var(--vscode-input-foreground, var(--vscode-foreground)); background: var(--vscode-input-background); }
        .resource-controls { display:flex; align-items:center; gap:8px 10px; flex-wrap:wrap; padding:0; color:var(--vscode-descriptionForeground); font-size:11px; }
        .resource-controls label { display: inline-flex; align-items: center; gap: 6px; }
        .resource-controls input { width: 64px; min-height: 26px; font-size: 11px; font-variant-numeric: tabular-nums; }
        .resource-controls button { display: inline-flex; align-items: center; gap: 5px; min-height: 26px; padding: 3px 6px; font-size: 11px; }
        #my-tasks-button[aria-pressed="true"] { color: var(--vscode-textLink-foreground, var(--vscode-focusBorder)); border-color: var(--vscode-focusBorder); }
        .user-filters { display:flex; align-items:center; gap:5px; overflow-x:auto; flex:1; min-width:180px; scrollbar-width:thin; }
        .filter-label { margin-right: 4px; white-space: nowrap; }
        .user-chip { min-height:24px; padding:2px 7px; color:var(--vscode-descriptionForeground); background:transparent; border:1px solid var(--vscode-widget-border); font-size:10px; white-space:nowrap; }
        .user-chip:hover { color:var(--vscode-foreground); background:var(--vscode-list-hoverBackground); }
        .user-chip.active { color:var(--vscode-foreground); background:var(--vscode-list-inactiveSelectionBackground,var(--vscode-button-secondaryBackground)); border-color:var(--vscode-focusBorder); }
        #content { display: grid; gap: 9px; }
        .dashboard-layout { display:grid; grid-template-columns:minmax(0,1fr); align-items:start; gap:14px; }
        .dashboard-layout.details-open { grid-template-columns:minmax(0,1fr) minmax(320px,380px); }
        .gpu-details { position:sticky; top:14px; max-height:calc(100vh - 28px); overflow:auto; min-width:0; border:1px solid var(--vscode-panel-border,var(--vscode-widget-border)); border-radius:6px; background:var(--vscode-sideBar-background,var(--vscode-editor-background)); box-shadow:0 2px 8px var(--vscode-widget-shadow); }
        .gpu-details[hidden] { display:none; }
        .gpu-details .process-inspector { margin:0; border:0; border-radius:0; }
        .gpu-details .inspector-header { position:sticky; top:0; z-index:1; padding:12px; background:var(--vscode-sideBar-background,var(--vscode-editor-background)); }
        .gpu-details .inspector-header > div { min-width:0; overflow-wrap:anywhere; }
        .gpu-details .task-inspector-layout { grid-template-columns:minmax(0,1fr); }
        .gpu-details .task-list { max-height:180px; border-right:0; border-bottom:1px solid var(--vscode-widget-border); }
        .gpu-details .task-details { max-height:none; overflow:visible; background:var(--vscode-editor-background); border-top:1px solid var(--vscode-widget-border); }
        .gpu-details .task-primary-actions, .gpu-details .dialog-actions { flex-wrap:wrap; }
        .gpu-details .inspector-empty { padding:12px; }
        #content { container-type:inline-size; }
        @container(max-width:850px) { .gpu-matrix.compact[class*="gpu-count-"] { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media(max-width:1000px) {
            .dashboard-layout.details-open { grid-template-columns:minmax(0,1fr); }
            .gpu-details { position:fixed; inset:12px 12px 12px auto; width:min(420px,calc(100vw - 24px)); max-height:none; z-index:20; box-shadow:0 6px 24px var(--vscode-widget-shadow); }
        }
        .server-band { min-width: 0; overflow: hidden; border: 1px solid var(--vscode-widget-border); border-left: 2px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-editor-background); }
        .server-band.stale { border-left-color: var(--vscode-editorWarning-foreground); }
        .server-band.offline, .server-band.offline.stale { border-left-color: var(--vscode-descriptionForeground); opacity: .82; }
        .offline-section { overflow: hidden; border: 1px solid var(--vscode-widget-border); border-radius: 5px; background: color-mix(in srgb, var(--vscode-sideBar-background) 70%, transparent); }
        .offline-summary { display: flex; align-items: center; gap: 7px; padding: 9px 11px; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 11px; font-weight: 600; list-style-position: outside; }
        .offline-summary:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
        .offline-indicator { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); opacity: .7; }
        .offline-summary-label { flex: 1; }
        .offline-count { min-width: 20px; padding: 1px 6px; border-radius: 9px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; text-align: center; }
        .offline-list { display: grid; gap: 7px; padding: 0 7px 7px; border-top: 1px solid var(--vscode-widget-border); }
        .offline-list .server-band:first-child { margin-top: 7px; }
        .server-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 11px; border-bottom: 1px solid var(--vscode-widget-border); background: color-mix(in srgb, var(--vscode-foreground) 3%, transparent); }
        .server-title { min-width: 0; }
        .server-name-row { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
        .server-name-row h2 { overflow: hidden; margin: 0; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
        .host-alias { color: var(--vscode-descriptionForeground); font-size: 10px; }
        .tag { flex: 0 0 auto; padding: 1px 5px; border-radius: 8px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 9px; }
        .tag.duplicate { color: var(--vscode-editorWarning-foreground); }
        .host-health { display: flex; align-items: center; gap: 18px; overflow-x: auto; padding: 5px 11px; border-bottom: 1px solid var(--vscode-widget-border); }
        .health-item { --meter-color: var(--vscode-charts-blue); display: grid; gap: 2px; min-width: 58px; white-space: nowrap; }
        .health-item.warning { --meter-color: var(--vscode-editorWarning-foreground); }
        .health-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 5px; }
        .health-item small { color: var(--vscode-descriptionForeground); font-size: 10px; }
        .health-item strong { font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .health-item.warning strong { color: var(--vscode-editorWarning-foreground); }
        .health-meter { width: 58px; height: 2px; }
        .server-error { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 11px; color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); font-size: 10px; }
        .error-retry { min-height: 22px; padding: 2px 7px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
        .gpu-matrix { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 7px; padding: 8px; align-items: start; }
        .gpu-matrix.compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .gpu-matrix.compact.gpu-count-1 { grid-template-columns: minmax(0, 1fr); }
        .gpu-matrix.compact.gpu-count-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .gpu-matrix.compact.gpu-count-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .gpu-tile { min-width: 0; overflow: hidden; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-editor-background); }
        .gpu-tile.available { border-left: 2px solid var(--vscode-testing-iconPassed); }
        .gpu-tile.has-warning { border-left: 2px solid var(--vscode-editorWarning-foreground); }
        .gpu-tile.selected { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
        .gpu-main { display: block; width: 100%; min-height: 112px; padding: 8px; border: 0; border-radius: 0; color: var(--vscode-foreground); background: transparent; text-align: left; }
        .gpu-main:hover { background: var(--vscode-list-hoverBackground); }
        .gpu-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin-bottom: 7px; }
        .gpu-identity { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .gpu-index { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 500; }
        .gpu-name { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
        .availability { flex: 0 0 auto; padding: 1px 3px; font-size: 10px; }
        .availability.available { color: var(--vscode-testing-iconPassed); }
        .availability.busy { color: var(--vscode-descriptionForeground); }
        .memory-row { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 10px; }
        .memory-row span:last-child { color: var(--vscode-foreground); white-space: nowrap; }
        .progress-track { height: 3px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
        .progress-fill { height: 100%; background: var(--vscode-charts-blue); }
        .warning-fill { background: var(--vscode-editorWarning-foreground); }
        .warning-text, .metric.warning strong { color: var(--vscode-editorWarning-foreground); }
        .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 14px; margin-top: 8px; }
        .metric { --meter-color: var(--vscode-descriptionForeground); display: grid; gap: 3px; min-width: 0; font-size: 11px; }
        .metric.warning { --meter-color: var(--vscode-editorWarning-foreground); }
        .metric-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 3px; min-width: 0; }
        .metric-heading span { overflow: hidden; color: var(--vscode-descriptionForeground); text-overflow: ellipsis; white-space: nowrap; }
        .metric strong { overflow: hidden; font-variant-numeric: tabular-nums; text-overflow: ellipsis; white-space: nowrap; }
        .metric-meter { height: 2px; }
        .process-count { overflow: hidden; margin-top: 7px; color: var(--vscode-descriptionForeground); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .gpu-actions { padding: 5px 7px; border-top: 1px solid var(--vscode-widget-border); }
        .action-button { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 2px 5px; color: var(--vscode-descriptionForeground); background: transparent; font-size: 10px; }
        .action-button:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
        .primary-action { color: var(--vscode-testing-iconPassed); }
        .process-inspector { margin: 0 8px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; background: var(--vscode-editor-background); }
        .inspector-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 9px; border-bottom: 1px solid var(--vscode-widget-border); }
        .inspector-empty, .empty-state { padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; }
        .process-scroll { max-height: 260px; overflow: auto; }
        .task-primary-actions { display:flex; gap:6px; padding:8px 12px; border-bottom:1px solid var(--vscode-widget-border); }
        .task-inspector-layout { display:grid; grid-template-columns:minmax(180px,30%) minmax(0,1fr); }
        .task-list { padding:6px; border-right:1px solid var(--vscode-widget-border); max-height:360px; overflow:auto; }
        .task-row { display:grid; width:100%; gap:4px; text-align:left; padding:9px 10px; border-radius:4px; color:var(--vscode-foreground); background:transparent; font-size:11px; }
        .task-row[aria-pressed="true"] { background:var(--vscode-list-inactiveSelectionBackground); outline:1px solid var(--vscode-focusBorder); outline-offset:-1px; }
        .task-entrypoint { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--vscode-editor-font-family); }
        .task-details { padding:12px; min-width:0; max-height:420px; overflow:auto; font-size:12px; }
        .task-command { white-space:pre-wrap; overflow-wrap:anywhere; padding:10px; background:var(--vscode-textCodeBlock-background); font-size:11px; line-height:1.6; user-select:text; }
        .task-parent { padding:8px 0; border-top:1px solid var(--vscode-widget-border); overflow-wrap:anywhere; }
        .task-parent code { white-space:pre-wrap; font-size:11px; margin:5px 0; }
        .task-ended { color:var(--vscode-editorWarning-foreground); }
        .task-sample-time { display:block; padding:6px 12px; }
        @media(max-width:680px) { .task-inspector-layout { grid-template-columns:1fr; } .task-list { max-height:150px; border-right:0; border-bottom:1px solid var(--vscode-widget-border); } }

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
            .toolbar-actions { flex-wrap: wrap; justify-content: flex-end; }
            .summary-strip { grid-template-columns: repeat(2, minmax(90px, 1fr)); }
            .summary-item:nth-child(3) { border-right: 1px solid var(--vscode-widget-border); }
            .summary-item:nth-child(even) { border-right: 0; }
            .fleet-controls { grid-template-columns: 1fr; }
            #sort-select { grid-column: auto; }
            .server-header { display: grid; }
            .server-actions { justify-content: flex-start; }
            .gpu-matrix, .gpu-matrix.compact[class*="gpu-count-"] { grid-template-columns: 1fr; }
        }
        @media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; transition: none !important; } }
        ${getDialogCss()}
        ${getAssistantCss()}
    `;
}
