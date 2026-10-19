import { preferenceFields } from './preferences';

export function getPreferencesHtml(): string {
    return `<dialog id="preferences-dialog" class="app-dialog" aria-labelledby="preferences-title">
        <header class="dialog-header"><h2 id="preferences-title"></h2><button type="button" id="preferences-close" class="secondary-button"></button></header>
        <nav id="preferences-tabs" class="preferences-tabs" aria-label="Settings sections"></nav>
        <form id="preferences-form">
            <div id="preferences-fields" class="preferences-fields"></div>
            <footer class="dialog-footer"><span id="preferences-status" role="status"></span><div class="dialog-actions"><button id="preferences-reset" type="button" class="secondary-button"></button><button id="preferences-discard" type="button" class="secondary-button" hidden></button><button id="preferences-save" type="submit"></button></div></footer>
        </form>
    </dialog>`;
}

export function getPreferencesScript(): string {
    return `
        (() => {
            const fields = ${JSON.stringify(preferenceFields)};
            const dialog = document.getElementById('preferences-dialog');
            const form = document.getElementById('preferences-form');
            const root = document.getElementById('preferences-fields');
            const tabs = document.getElementById('preferences-tabs');
            const status = document.getElementById('preferences-status');
            const save = document.getElementById('preferences-save');
            let latest = {};
            let baseline = {};
            let activeTab = 'servers';
            let saving = false;
            let hasKey = false;
            let catalog = [];
            let gpuSelection = {};
            const tr = (en, zh) => language === 'zh-CN' ? zh : en;

            function activate(group) {
                activeTab = group;
                for (const section of root.querySelectorAll('.preference-group')) section.hidden = section.dataset.group !== group;
                for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.group === group));
            }
            function values() {
                const result = {};
                for (const field of fields) {
                    const input = document.getElementById('pref-' + field.key);
                    result[field.key] = field.type === 'gpus' ? gpuSelection
                        : field.type === 'events' ? [...input.querySelectorAll('input:checked')].map(item => item.value)
                        : field.type === 'boolean' ? input.checked
                        : field.type === 'number' ? Number(input.value)
                        : field.type === 'hosts' ? input.value.split(/[\\n,]+/).map(value => value.trim()).filter(Boolean)
                        : input.value.trim();
                }
                return result;
            }
            function dirtyValues() {
                return Object.fromEntries(Object.entries(values()).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key])));
            }
            function keyAction(command) {
                const dirty = dirtyValues();
                if ('ai.protocol' in dirty || 'ai.baseUrl' in dirty) {
                    status.textContent = t('saveEndpointFirst');
                    return;
                }
                vscode.postMessage({ command });
            }
            function fill() {
                baseline = {};
                gpuSelection = JSON.parse(JSON.stringify(latest.visibleGpus || {}));
                root.replaceChildren();
                tabs.replaceChildren();
                document.getElementById('preferences-title').textContent = t('settings');
                const close = document.getElementById('preferences-close');
                close.replaceChildren(icon('x'), document.createTextNode(t('close')));
                save.textContent = t('saveSettings');
                status.textContent = '';
                document.getElementById('preferences-discard').hidden = true;
                document.getElementById('preferences-reset').textContent = tr('Reset this section', '重置当前页');
                for (const group of ['servers', 'refresh', 'display', 'availability', 'notifications', 'ai']) {
                    const tab = button(t('preferences_' + group), 'secondary-button', () => activate(group));
                    tab.dataset.group = group;
                    tabs.append(tab);
                    const section = node('section', 'preference-group');
                    section.dataset.group = group;
                    section.setAttribute('aria-label', t('preferences_' + group));
                    for (const field of fields.filter(item => item.group === group)) {
                        const label = node(['gpus','events'].includes(field.type) ? 'div' : 'label', field.type === 'boolean' ? 'preference-field checkbox-field' : 'preference-field');
                        const id = 'pref-' + field.key;
                        label.htmlFor = id;
                        const title = node('span', '', field.label[language === 'zh-CN' ? 1 : 0]);
                        const input = document.createElement(['gpus','events'].includes(field.type) ? 'div' : field.type === 'hosts' ? 'textarea' : field.type === 'enum' ? 'select' : 'input');
                        input.id = id;
                        input.name = field.key;
                        const value = latest[field.key] === undefined ? field.default : latest[field.key];
                        baseline[field.key] = value;
                        if (field.type === 'gpus') {
                            label.classList.add('gpu-scope-setting');
                            label.append(title, node('p','subtle settings-help',tr('Display and AI scope only. Existing reminders keep monitoring hidden cards.','仅影响显示与默认 AI 范围；已有提醒继续监测被隐藏的卡。')));
                            const entries = new Map(catalog.map(server => [server.host, server]));
                            for (const host of Object.keys(gpuSelection)) if (!entries.has(host)) entries.set(host,{host,label:host,gpus:[]});
                            if (!entries.size) input.append(node('p','subtle',tr('Choose servers and refresh once to discover GPUs.','选择服务器并刷新一次，即可勾选 GPU。')));
                            for (const server of entries.values()) {
                                const card = node('fieldset','gpu-scope-card');
                                card.append(node('legend','',server.label || server.host));
                                const all = document.createElement('input'); all.type='checkbox'; all.checked=gpuSelection[server.host]===undefined;
                                const allLabel=node('label','checkbox-field'); allLabel.append(all,document.createTextNode(tr('All GPUs (including new cards)','全部 GPU（含以后新增的卡）')));card.append(allLabel);
                                const list=node('div','gpu-scope-choices');
                                const choices=[];
                                let manual;
                                for (const gpu of server.gpus) {
                                    const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.value=gpu.index;
                                    checkbox.checked=all.checked || gpuSelection[server.host].includes(gpu.index) || gpuSelection[server.host].includes(gpu.uuid);
                                    const option=node('label','checkbox-field'); option.title=gpu.name+' · '+gpu.uuid;
                                    option.append(checkbox,document.createTextNode('GPU '+gpu.index));list.append(option);choices.push(checkbox);
                                    checkbox.onchange=()=>{ all.checked=false; gpuSelection[server.host]=choices.filter(c=>c.checked).map(c=>c.value); };
                                }
                                all.onchange=()=>{ if(all.checked){delete gpuSelection[server.host];choices.forEach(c=>c.checked=true);}else{gpuSelection[server.host]=choices.filter(c=>c.checked).map(c=>c.value);}if(manual){manual.disabled=all.checked;if(all.checked)manual.value='';} };
                                card.append(list);
                                if (!server.gpus.length) {
                                    manual=document.createElement('input');manual.type='text';manual.disabled=all.checked;manual.placeholder=tr('GPU indices, e.g. 0,2,3','GPU 编号，例如 0,2,3');manual.value=(gpuSelection[server.host]||[]).join(',');
                                    manual.oninput=()=>{all.checked=false;gpuSelection[server.host]=manual.value.split(',').map(v=>v.trim()).filter(Boolean);};card.append(manual);
                                }
                                input.append(card);
                            }
                        } else if (field.type === 'events') {
                            const labels={serverState:tr('Server online/offline','服务器上下线'),gpuAvailable:tr('GPU becomes available','GPU 变为空闲'),threshold:tr('Threshold warnings','阈值告警')};
                            for (const event of field.options) {
                                const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=event;checkbox.checked=value.includes(event);
                                const option=node('label','checkbox-field');option.append(checkbox,document.createTextNode(labels[event]));input.append(option);
                            }
                        } else if (field.type === 'enum') {
                            for (const option of field.options) {
                                const entry = node('option', '', option === 'auto' ? t('followEditor') : option === 'openai' ? 'OpenAI compatible' : option === 'anthropic' ? 'Anthropic Messages' : option);
                                entry.value = option;
                                input.append(entry);
                            }
                        } else if (field.type === 'boolean') {
                            input.type = 'checkbox';
                            input.checked = value;
                        } else if (field.type === 'number') {
                            input.type = 'number'; input.min = field.min; input.max = field.max; input.step = 'any'; input.required = true;
                        } else if (field.type === 'hosts') {
                            input.rows = 3;
                        } else {
                            input.type = 'text'; input.maxLength = 2048; input.spellcheck = false;
                        }
                        if (!['boolean','gpus','events'].includes(field.type)) input.value = Array.isArray(value) ? value.join('\\n') : value;
                        if (field.type === 'boolean') label.append(input, title); else if(field.type === 'gpus') label.append(input); else label.append(title, input);
                        section.append(label);
                    }
                    if (group === 'servers') {
                        const actions = node('div', 'dialog-actions');
                        actions.append(button(t('chooseServers'), 'secondary-button', () => vscode.postMessage({ command: 'configureServers' })),
                            button(t('addServer'), 'secondary-button', () => vscode.postMessage({ command: 'addServer' })));
                        section.append(actions);
                    }
                    if (group === 'ai') {
                        section.append(node('p', 'subtle settings-help', t('aiSettingsHelp')));
                        const actions = node('div', 'dialog-actions');
                        actions.append(node('span', 'key-status', hasKey ? t('keyConfigured') : t('keyMissing')),
                            button(t('setKey'), 'secondary-button', () => keyAction('setAiKey')),
                            button(t('deleteKey'), 'secondary-button', () => keyAction('deleteAiKey')));
                        section.append(actions);
                    }
                    root.append(section);
                }
                const advanced = button(t('nativeSettings'), 'text-button', () => vscode.postMessage({ command: 'openNativeSettings' }));
                root.append(advanced);
                activate(activeTab);
                dependencies();
            }
            window.addEventListener('openPreferences', event => {
                if (event.detail) activeTab = event.detail;
                if (!dialog.open) { fill(); openDialog(dialog); }
                else activate(activeTab);
            });
            const discard=document.getElementById('preferences-discard');
            function closePreferences() {
                if(saving) return;
                if(Object.keys(dirtyValues()).length){status.textContent=tr('Unsaved changes. Save or discard to close.','存在未保存的更改，请保存或放弃后关闭。');discard.hidden=false;discard.textContent=tr('Discard changes','放弃更改');return;}
                closeDialog(dialog);
            }
            document.getElementById('preferences-close').onclick=closePreferences;
            dialog.addEventListener('cancel',event=>{event.preventDefault();closePreferences();});
            discard.onclick=()=>{if(!saving)closeDialog(dialog);};
            document.getElementById('preferences-reset').onclick=()=>{
                for(const field of fields.filter(f=>f.group===activeTab)) {
                    const input=document.getElementById('pref-'+field.key);
                    if(field.type==='gpus') {gpuSelection={};for(const c of input.querySelectorAll('input[type=checkbox]'))c.checked=true;for(const manual of input.querySelectorAll('input[type=text]')){manual.value='';manual.disabled=true;}}
                    else if(field.type==='events') for(const c of input.querySelectorAll('input'))c.checked=field.default.includes(c.value);
                    else if(field.type==='boolean')input.checked=field.default;
                    else input.value=Array.isArray(field.default)?field.default.join('\\n'):field.default;
                }
                status.textContent=t('unsavedSettings');dependencies();
            };
            function dependencies(){
                const enabled=key=>document.getElementById('pref-'+key).checked;
                for(const key of ['refreshInterval','pauseWhenHidden'])document.getElementById('pref-'+key).disabled=!enabled('autoRefresh');
                document.getElementById('pref-slurmRefreshInterval').disabled=!enabled('enableSlurmIntegration');
                for(const item of document.getElementById('pref-notificationEvents').querySelectorAll('input'))item.disabled=!enabled('enableNotifications');
                document.getElementById('pref-notificationCooldownSeconds').disabled=!enabled('enableNotifications');
            }
            form.addEventListener('change',dependencies);
            form.addEventListener('input', () => { status.textContent = t('unsavedSettings'); });
            form.addEventListener('submit', event => {
                event.preventDefault();
                if (saving) return;
                const invalid = form.querySelector(':invalid');
                if (invalid) {
                    activate(invalid.closest('.preference-group').dataset.group);
                    invalid.reportValidity();
                    return;
                }
                const changes = dirtyValues();
                if (!Object.keys(changes).length) { status.textContent = t('settingsSaved'); return; }
                saving = true; save.disabled = true; status.textContent = t('savingSettings');
                vscode.postMessage({ command: 'savePreferences', values: changes });
            });
            window.addEventListener('message', event => {
                const message = event.data;
                if (!message || typeof message !== 'object') return;
                if (message.type === 'update' && message.preferences) {
                    latest = message.preferences;
                    catalog = message.gpuCatalog || message.data || [];
                    hasKey = Boolean(message.aiConfigured);
                    const keyStatus = root.querySelector('.key-status');
                    if (keyStatus) keyStatus.textContent = hasKey ? t('keyConfigured') : t('keyMissing');
                    // Never reconstruct an open form during metric refreshes.
                }
                if (message.type === 'preferencesResult') {
                    saving = false; save.disabled = false;
                    if (message.success) {
                        baseline = { ...baseline, ...message.values };
                        latest = { ...latest, ...message.values };
                        discard.hidden = true;
                        status.textContent = Object.keys(dirtyValues()).length ? t('unsavedSettings') : t('settingsSaved');
                    } else status.textContent = message.error || t('settingsError');
                }
            });
        })();
    `;
}

export function getDialogCss(): string {
    return `
        .app-dialog { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 40px); padding: 0; border: 1px solid var(--vscode-widget-border); border-radius: 8px; color: var(--vscode-foreground); background: var(--vscode-editor-background); box-shadow: 0 12px 48px #0005; }
        .app-dialog::backdrop { background: #0006; }
        .dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--vscode-widget-border); }
        .dialog-header h2 { margin: 0; font-size: 15px; font-weight: 600; }
        .dialog-header button { display: inline-flex; align-items: center; gap: 5px; }
        .preferences-tabs { display: flex; gap: 4px; flex-wrap: wrap; padding: 10px 16px; border-bottom: 1px solid var(--vscode-widget-border); }
        .preferences-tabs button { min-height: 28px; font-size: 12px; background: transparent; }
        .preferences-tabs button[aria-pressed="true"] { color: var(--vscode-textLink-foreground, var(--vscode-focusBorder)); background: var(--vscode-list-activeSelectionBackground); }
        .preferences-fields { padding: 16px 18px; max-height: calc(100vh - 250px); overflow: auto; }
        .preference-group:not([hidden]) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 16px 24px; }
        .gpu-scope-setting { grid-column: 1 / -1; }
        .gpu-scope-card { border: 1px solid var(--vscode-widget-border); border-radius: 4px; margin: 8px 0; padding: 8px 12px; }
        .gpu-scope-choices { display: flex; flex-wrap: wrap; gap: 6px 16px; }
        .preference-field { display: grid; min-width: 0; gap: 6px; font-size: 12px; }
        .preference-field input:not([type="checkbox"]), .preference-field select, .preference-field textarea { width: 100%; min-width: 0; }
        .preference-field textarea { resize: vertical; }
        .checkbox-field { display: flex; align-items: center; gap: 8px; min-height: 30px; }
        input[type="checkbox"] { min-height: auto; accent-color: var(--vscode-focusBorder); }
        .settings-help, .dialog-actions { grid-column: 1 / -1; }
        .settings-help { margin: 0; line-height: 1.6; font-size: 12px; }
        .dialog-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .key-status { color: var(--vscode-descriptionForeground); font-size: 12px; }
        .text-button { color: var(--vscode-textLink-foreground, var(--vscode-focusBorder)); background: transparent; }
        .text-button:hover { background: var(--vscode-list-hoverBackground); }
        .dialog-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-top: 1px solid var(--vscode-widget-border); font-size: 12px; }
        .dialog-footer [role="status"] { min-width: 0; overflow-wrap: anywhere; }
        @media(max-width: 500px) { .preference-group:not([hidden]) { grid-template-columns: 1fr; } }
    `;
}
