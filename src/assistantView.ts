export function getAssistantHtml(): string {
    return `<dialog id="assistant-dialog" class="app-dialog assistant-dialog" aria-labelledby="assistant-title">
        <header class="dialog-header"><h2 id="assistant-title"></h2><div class="dialog-actions"><button id="assistant-settings" class="secondary-button" type="button"></button><button id="assistant-close" class="secondary-button" type="button"></button></div></header>
        <p id="assistant-description" class="assistant-description"></p>
        <div id="assistant-suggestions" class="assistant-suggestions"></div>
        <div id="assistant-messages" class="assistant-messages" role="log" aria-live="polite"></div>
        <form id="assistant-form" class="assistant-form">
            <label class="checkbox-field"><input id="assistant-share" type="checkbox"><span id="assistant-share-label"></span></label>
            <label class="checkbox-field"><input id="assistant-commands" type="checkbox" disabled><span id="assistant-commands-label"></span></label>
            <details id="assistant-context-details" hidden><summary id="assistant-context-label"></summary><pre id="assistant-context"></pre></details>
            <label for="assistant-prompt" id="assistant-prompt-label"></label>
            <textarea id="assistant-prompt" rows="3" maxlength="8000" required></textarea>
            <footer class="assistant-footer"><span id="assistant-status" role="status"></span><div class="dialog-actions"><button id="assistant-clear" type="button" class="secondary-button"></button><button id="assistant-cancel" type="button" class="secondary-button" hidden></button><button id="assistant-send" type="submit"></button></div></footer>
        </form>
    </dialog>`;
}

export function getAssistantScript(): string {
    return `
        (() => {
            const dialog = document.getElementById('assistant-dialog');
            const messages = document.getElementById('assistant-messages');
            const prompt = document.getElementById('assistant-prompt');
            const share = document.getElementById('assistant-share');
            const commands = document.getElementById('assistant-commands');
            const status = document.getElementById('assistant-status');
            const send = document.getElementById('assistant-send');
            const cancel = document.getElementById('assistant-cancel');
            const clear = document.getElementById('assistant-clear');
            let busy = false;
            let contextId;
            let requestId = 0;
            let configured = false;
            let contextPending = false;

            function updateControls() {
                send.disabled = busy || contextPending || !configured;
                prompt.disabled = busy;
                cancel.hidden = !busy;
                clear.disabled = busy;
                share.disabled = busy;
                commands.disabled = busy || !share.checked;
                send.setAttribute('aria-busy', String(busy));
            }
            function labels() {
                document.getElementById('assistant-title').textContent = t('assistant');
                document.getElementById('assistant-description').textContent = t('assistantDescription');
                document.getElementById('assistant-share-label').textContent = t('shareFleet');
                document.getElementById('assistant-commands-label').textContent = t('shareCommands');
                document.getElementById('assistant-context-label').textContent = t('previewContext');
                document.getElementById('assistant-prompt-label').textContent = t('askQuestion');
                prompt.placeholder = t('questionPlaceholder');
                document.getElementById('assistant-settings').replaceChildren(icon('settings-2'), document.createTextNode(t('settings')));
                document.getElementById('assistant-close').replaceChildren(icon('x'), document.createTextNode(t('close')));
                send.replaceChildren(icon('send'), document.createTextNode(t('sendQuestion')));
                cancel.textContent = t('cancelRequest');
                clear.replaceChildren(icon('trash-2'), document.createTextNode(t('clearChat')));
                const suggestions = document.getElementById('assistant-suggestions');
                const fragment = document.createDocumentFragment();
                for (const key of ['suggestAvailable', 'suggestCapacity', 'suggestLoad']) {
                    fragment.append(button(t(key), 'secondary-button', () => { prompt.value = t(key); prompt.focus(); }));
                }
                patchChildren(suggestions, fragment);
                if (!busy) status.textContent = configured ? t('aiReady') : t('configureAiFirst');
                updateControls();
            }
            function prepare() {
                contextId = undefined;
                document.getElementById('assistant-context-details').hidden = !share.checked;
                commands.disabled = !share.checked;
                if (!share.checked) { contextPending = false; updateControls(); return; }
                contextPending = true;
                document.getElementById('assistant-context').textContent = t('preparingContext');
                vscode.postMessage({ command: 'prepareAiContext', includeCommands: commands.checked, requestId: ++requestId });
                updateControls();
            }
            function append(role, text) {
                const entry = node('section', 'chat-entry ' + role);
                entry.append(node('strong', 'chat-role', role === 'user' ? t('you') : role === 'error' ? t('requestError') : t('assistant')),
                    node('div', 'chat-text', text));
                messages.append(entry);
                while (messages.childElementCount > 32) messages.firstElementChild.remove();
                messages.scrollTop = messages.scrollHeight;
            }
            window.addEventListener('openAssistant', () => {
                labels();
                if (!dialog.open) openDialog(dialog);
                prompt.focus();
            });
            document.getElementById('assistant-close').onclick = () => closeDialog(dialog);
            document.getElementById('assistant-settings').onclick = () => {
                closeDialog(dialog);
                window.dispatchEvent(new CustomEvent('openPreferences', { detail: 'ai' }));
            };
            share.onchange = prepare;
            commands.onchange = prepare;
            cancel.onclick = () => vscode.postMessage({ command: 'cancelAi' });
            clear.onclick = () => { messages.replaceChildren(); vscode.postMessage({ command: 'clearAi' }); status.textContent = t('aiReady'); };
            document.getElementById('assistant-form').onsubmit = event => {
                event.preventDefault();
                const question = prompt.value.trim();
                if (busy || contextPending || !configured || !question || (share.checked && !contextId)) return;
                append('user', question);
                busy = true; updateControls(); status.textContent = t('thinking');
                vscode.postMessage({ command: 'askAi', question, contextId: share.checked ? contextId : undefined });
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (!message || typeof message !== 'object') return;
                if (message.type === 'update') {
                    configured = Boolean(message.aiConfigured && message.preferences && message.preferences['ai.model']);
                    if (dialog.open) labels();
                } else if (message.type === 'aiContext' && message.requestId === requestId) {
                    contextPending = false;
                    contextId = message.id;
                    document.getElementById('assistant-context').textContent = message.context || message.error;
                    updateControls();
                } else if (message.type === 'aiResult') {
                    busy = false; updateControls();
                    if (message.answer) { append('assistant', message.answer); prompt.value = ''; status.textContent = t('aiReady'); }
                    else { append('error', message.error || t('requestError')); status.textContent = message.error || t('requestError'); }
                    if (dialog.open) prompt.focus();
                } else if (message.type === 'aiReset') {
                    messages.replaceChildren();
                    contextId = undefined;
                    busy = false;
                    if (share.checked) prepare();
                    labels();
                }
            });
        })();
    `;
}

export function getAssistantCss(): string {
    return `
        .assistant-dialog { width: min(720px, calc(100vw - 32px)); }
        .assistant-description { margin: 14px 18px 8px; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.6; }
        .assistant-suggestions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 18px 12px; }
        .assistant-suggestions button { font-size: 11px; }
        .assistant-messages { max-height: 34vh; overflow: auto; padding: 0 18px; }
        .chat-entry { padding: 12px 0; border-top: 1px solid var(--vscode-widget-border); }
        .chat-role { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 5px; }
        .chat-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; user-select: text; }
        .chat-entry.error .chat-text { color: var(--vscode-editorWarning-foreground); }
        .assistant-form { display: grid; gap: 8px; padding: 12px 18px 16px; border-top: 1px solid var(--vscode-widget-border); font-size: 12px; }
        .assistant-form textarea { width: 100%; resize: vertical; min-height: 72px; max-height: 200px; }
        #assistant-context { max-height: 160px; overflow: auto; padding: 10px; background: var(--vscode-textCodeBlock-background); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
        .assistant-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .assistant-footer button { display: inline-flex; align-items: center; gap: 6px; }
        #assistant-status { color: var(--vscode-descriptionForeground); max-width: 100%; overflow-wrap: anywhere; }
    `;
}
