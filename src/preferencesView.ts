import { preferenceFields } from './preferences';

export function getPreferencesHtml(): string {
    return `<dialog id="preferences-dialog" class="app-dialog" aria-labelledby="preferences-title">
        <header class="dialog-header"><h2 id="preferences-title"></h2><button type="button" id="preferences-close" class="secondary-button"></button></header>
        <nav id="preferences-tabs" class="preferences-tabs" aria-label="Settings sections"></nav>
        <form id="preferences-form">
            <div id="preferences-fields" class="preferences-fields"></div>
            <footer class="dialog-footer"><span id="preferences-status" role="status"></span><button id="preferences-save" type="submit"></button></footer>
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

            function activate(group) {
                activeTab = group;
                for (const section of root.querySelectorAll('.preference-group')) section.hidden = section.dataset.group !== group;
                for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.group === group));
            }
            function values() {
                const result = {};
                for (const field of fields) {
                    const input = document.getElementById('pref-' + field.key);
                    result[field.key] = field.type === 'boolean' ? input.checked
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
                root.replaceChildren();
                tabs.replaceChildren();
                document.getElementById('preferences-title').textContent = t('settings');
                const close = document.getElementById('preferences-close');
                close.replaceChildren(icon('x'), document.createTextNode(t('close')));
                save.textContent = t('saveSettings');
                status.textContent = '';
                for (const group of ['servers', 'refresh', 'display', 'availability', 'notifications', 'ai']) {
                    const tab = button(t('preferences_' + group), 'secondary-button', () => activate(group));
                    tab.dataset.group = group;
                    tabs.append(tab);
                    const section = node('section', 'preference-group');
                    section.dataset.group = group;
                    section.setAttribute('aria-label', t('preferences_' + group));
                    for (const field of fields.filter(item => item.group === group)) {
                        const label = node('label', field.type === 'boolean' ? 'preference-field checkbox-field' : 'preference-field');
                        const id = 'pref-' + field.key;
                        label.htmlFor = id;
                        const title = node('span', '', field.label[language === 'zh-CN' ? 1 : 0]);
                        const input = document.createElement(field.type === 'hosts' ? 'textarea' : field.type === 'enum' ? 'select' : 'input');
                        input.id = id;
                        input.name = field.key;
                        const value = latest[field.key] === undefined ? field.default : latest[field.key];
                        baseline[field.key] = value;
                        if (field.type === 'enum') {
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
                        if (field.type !== 'boolean') input.value = Array.isArray(value) ? value.join('\\n') : value;
                        if (field.type === 'boolean') label.append(input, title); else label.append(title, input);
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
            }
            window.addEventListener('openPreferences', event => {
                if (event.detail) activeTab = event.detail;
                if (!dialog.open) { fill(); openDialog(dialog); }
                else activate(activeTab);
            });
            document.getElementById('preferences-close').onclick = () => closeDialog(dialog);
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
