export function getAssistantHtml(): string {
    return `<dialog id="assistant-dialog" class="app-dialog assistant-dialog" aria-labelledby="assistant-title">
        <header class="dialog-header"><h2 id="assistant-title"></h2><button id="assistant-sidebar-toggle" class="secondary-button" type="button" aria-expanded="false"></button><div class="dialog-actions"><button id="assistant-clear" class="secondary-button" type="button"></button><button id="assistant-settings" class="secondary-button" type="button"></button><button id="assistant-close" class="secondary-button" type="button"></button></div></header>
        <div class="assistant-layout"><div class="assistant-chat">
            <div id="assistant-messages" class="assistant-messages" role="log" aria-label="Conversation"></div>
            <form id="assistant-form" class="assistant-form">
                <label for="assistant-prompt" id="assistant-prompt-label" class="subtle"></label>
                <textarea id="assistant-prompt" rows="3" maxlength="8000" required></textarea>
                <footer class="assistant-footer"><span id="assistant-status" role="status"></span><div class="dialog-actions"><button id="assistant-cancel" type="button" class="secondary-button" hidden></button><button id="assistant-send" type="submit"></button></div></footer>
            </form>
        </div><aside class="assistant-sidebar" aria-label="Task context and reminders">
            <details class="assistant-context-section" open><summary id="assistant-context-title"></summary><label for="assistant-server" class="subtle" id="assistant-server-label"></label><select id="assistant-server"></select><div id="assistant-scope" class="subtle"></div><p id="assistant-privacy" class="subtle"></p><div id="assistant-context-data"></div></details>
            <section><h3 id="assistant-reminders-title"></h3><p id="assistant-reminder-help" class="subtle"></p><div id="assistant-reminders"></div></section>
            <section><h3 id="assistant-logs-title"></h3><div id="assistant-logs"></div><button id="assistant-add-log" class="text-button" type="button"></button></section>
            <details><summary id="assistant-tools-title"></summary><div id="assistant-tools"></div></details>
        </aside></div>
    </dialog>`;
}
export function getAssistantScript(): string {
    return `
        (() => {
            const dialog=document.getElementById('assistant-dialog');
            const messages=document.getElementById('assistant-messages');
            const prompt=document.getElementById('assistant-prompt');
            const status=document.getElementById('assistant-status');
            const send=document.getElementById('assistant-send');
            const cancel=document.getElementById('assistant-cancel');
            const clear=document.getElementById('assistant-clear');
            const tr=(en,zh)=>language==='zh-CN'?zh:en;
            let busy=false,configured=false,currentReply,lastQuestion='',compatibilityWarning='',state={servers:[],reminders:[],logs:[]},selection;
            function controls(){send.disabled=busy||!configured;cancel.hidden=!busy;clear.disabled=busy;send.setAttribute('aria-busy',String(busy));}
            function labels(){
                document.getElementById('assistant-title').textContent=t('assistant');
                document.getElementById('assistant-prompt-label').textContent=tr('Enter to send · Shift+Enter for a new line','Enter 发送 · Shift+Enter 换行');
                prompt.placeholder=tr('Ask about GPUs, task progress, errors or reminders…','询问 GPU、任务进度、异常，或设置提醒…');
                for(const [id,name,label] of [['assistant-settings','settings-2',t('settings')],['assistant-close','x',t('close')],['assistant-clear','trash-2',t('clearChat')],['assistant-send','send',t('sendQuestion')]])document.getElementById(id).replaceChildren(icon(name),document.createTextNode(label));
                cancel.textContent=t('cancelRequest');
                document.getElementById('assistant-sidebar-toggle').textContent=tr('Context','上下文');
                document.getElementById('assistant-server-label').textContent=tr('Conversation scope','对话范围');
                document.getElementById('assistant-context-title').textContent=tr('Current context','当前上下文');
                document.getElementById('assistant-reminders-title').textContent=tr('Reminders','我的提醒');
                document.getElementById('assistant-reminder-help').textContent=tr('Runs while desktop VS Code is awake.','需要本机 VS Code 运行且电脑未休眠。');
                document.getElementById('assistant-logs-title').textContent=tr('Task logs','任务日志');
                document.getElementById('assistant-add-log').textContent=tr('Authorize a log path…','授权日志路径…');
                document.getElementById('assistant-tools-title').textContent=tr('Query activity','查询记录');
                if(!busy)status.textContent=configured?t('aiReady'):t('configureAiFirst');
                controls();renderState();
            }
            function entry(role,text){
                const section=node('section','chat-entry '+role);
                section.append(node('strong','chat-role',role==='user'?t('you'):role==='error'?t('requestError'):t('assistant')));
                const body=node('div','chat-text',text||'');section.append(body);messages.append(section);
                while(messages.childElementCount>32)messages.firstElementChild.remove();return body;
            }
            function nearBottom(){return messages.scrollHeight-messages.scrollTop-messages.clientHeight<70;}
            function answer(message){
                const follow=nearBottom();
                if(!currentReply||!currentReply.isConnected)currentReply=entry('assistant','');
                if(typeof message.html==='string')currentReply.innerHTML=message.html;else currentReply.textContent=message.answer||'';
                for(const pre of currentReply.querySelectorAll('pre')){
                    const copy=button(t('copy'),'code-copy secondary-button',()=>vscode.postMessage({command:'copyAiText',text:pre.querySelector('code')?.textContent||''}));pre.append(copy);
                }
                if(follow)messages.scrollTop=messages.scrollHeight;
            }
            function renderState(){
                const serverSelect=document.getElementById('assistant-server');
                const options=document.createDocumentFragment();const all=node('option','',tr('Dashboard scope','仪表盘范围'));all.value='';options.append(all);
                for(const server of state.servers){const option=node('option','',server.label);option.value=server.id;options.append(option);}
                patchChildren(serverSelect,options);serverSelect.value=state.scope?.server||'';
                const scope=document.getElementById('assistant-scope');
                const selected=state.servers.find(s=>s.id===state.scope?.server);
                scope.textContent=selected?selected.label+(state.scope.uuid?' · '+state.scope.uuid:'')+(state.scope.pid?' · PID '+state.scope.pid:''):tr('Visible dashboard GPUs','仪表盘中显示的 GPU');
                document.getElementById('assistant-privacy').textContent=tr('Local SSH · Data is sent to ','本机 SSH · 提问时数据发送至 ')+(state.endpoint||tr('your API','所配 API'));
                const data=document.getElementById('assistant-context-data');const contextFragment=document.createDocumentFragment();
                for(const server of currentMessage?.data||[]) {
                    const line=node('div','context-server');line.dataset.key=server.host;
                    line.append(node('strong','',server.metadata?.alias||server.host),node('span','subtle block',server.error?tr('Offline / unknown','离线 / 状态未知'):server.gpus.filter(g=>g.availability.available).length+'/'+server.gpus.length+tr(' GPUs available',' 张可用')),
                        node('span','subtle block',new Date(server.lastSuccessAt||server.collectedAt).toLocaleTimeString()+(server.stale?' · '+tr('stale','旧数据'):'')));contextFragment.append(line);
                }
                patchChildren(data,contextFragment);
                const watches=document.createDocumentFragment();
                for(const watch of state.reminders.filter(w=>w.status==='active')) {
                    const box=node('div','assistant-watch');box.dataset.key=watch.id;
                    const label=state.servers.find(s=>s.id===watch.server)?.label||watch.server;
                    const mode=watch.mode==='available'?tr('GPU release','GPU 释放'):watch.mode==='taskEnded'?tr('Task end','任务结束'):tr('Scheduled check','定时检查');
                    box.append(node('strong','',label+' · '+mode));
                    const selectedIds=watch.gpuIds||[];
                    if(selectedIds.length)box.append(node('span','subtle block',selectedIds.map(uuid=>{const gpu=currentMessage?.data.find(s=>s.host===label||s.metadata?.alias===label)?.gpus.find(g=>g.uuid===uuid);return gpu?'GPU '+gpu.index:uuid+tr(' (outside view)','（显示范围外）');}).join(', ')));
                    box.append(node('span','subtle block',tr('Until ','有效至 ')+new Date(watch.expiresAt).toLocaleString()));
                    if(watch.at)box.append(node('span','subtle block',tr('Check at ','检查时间 ')+new Date(watch.at).toLocaleString()));
                    if(watch.error)box.append(node('span','subtle block',watch.error));
                    box.append(button(tr('Edit deadline','修改有效期'),'text-button',()=>vscode.postMessage({command:'editReminder',id:watch.id})));
                    box.append(button(t('cancelRequest'),'text-button',()=>vscode.postMessage({command:'cancelReminder',id:watch.id})));watches.append(box);
                }
                if(!watches.childNodes.length)watches.append(node('p','subtle',tr('No active reminders. Ask in chat or use a GPU’s reminder action.','暂无提醒。可在对话中提出，或从 GPU 详情中设置。')));
                patchChildren(document.getElementById('assistant-reminders'),watches);
                const logs=document.createDocumentFragment();
                for(const log of state.logs){
                    const row=node('div','assistant-log');row.dataset.key=log.server+':'+log.path;row.append(node('code','',log.path));
                    row.append(button(log.authorized?tr('Revoke','撤销授权'):tr('Authorize','授权'),'text-button',()=>vscode.postMessage({command:'authorizeTaskLog',server:log.server,path:log.path,revoke:log.authorized})));logs.append(row);
                }
                if(!logs.childNodes.length)logs.append(node('p','subtle',tr('Inspect a task to discover its log, or authorize a known path.','查询任务后可发现日志，也可授权已知路径。')));
                patchChildren(document.getElementById('assistant-logs'),logs);
            }
            window.addEventListener('openAssistant',event=>{
                selection=event.detail||selection;
                if(selection?.question)prompt.value=selection.question;
                labels();if(!dialog.open)openDialog(dialog);prompt.focus();
                vscode.postMessage({command:'aiState',host:selection?.host,uuid:selection?.uuid,pid:selection?.pid});
            });
            document.getElementById('assistant-sidebar-toggle').onclick=()=>{const open=document.querySelector('.assistant-sidebar').classList.toggle('mobile-open');document.getElementById('assistant-sidebar-toggle').setAttribute('aria-expanded',String(open));};
            document.getElementById('assistant-server').onchange=event=>{selection=undefined;vscode.postMessage({command:'aiState',scopeServer:event.target.value||null});};
            document.getElementById('assistant-close').onclick=()=>closeDialog(dialog);
            document.getElementById('assistant-settings').onclick=()=>{closeDialog(dialog);document.getElementById('preferences-dialog').addEventListener('close',()=>{labels();openDialog(dialog);prompt.focus();},{once:true});window.dispatchEvent(new CustomEvent('openPreferences',{detail:'ai'}));};
            document.getElementById('assistant-add-log').onclick=()=>{
                let server=state.scope?.server;
                if(!server&&state.servers.length===1)server=state.servers[0].id;
                if(!server){status.textContent=tr('Open chat from the relevant GPU first to select its server.','请先从目标 GPU 的“问 AI”入口选择服务器。');return;}
                vscode.postMessage({command:'authorizeTaskLog',server});
            };
            cancel.onclick=()=>{cancel.disabled=true;vscode.postMessage({command:'cancelAi'});};
            clear.onclick=()=>{messages.replaceChildren();document.getElementById('assistant-tools').replaceChildren();currentReply=undefined;vscode.postMessage({command:'clearAi'});};
            prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!busy)document.getElementById('assistant-form').requestSubmit();}});
            document.getElementById('assistant-form').onsubmit=event=>{
                event.preventDefault();const question=prompt.value.trim();if(busy||!configured||!question)return;
                compatibilityWarning='';lastQuestion=question;entry('user',question);currentReply=entry('assistant',tr('Working…','正在查询…'));
                messages.scrollTop=messages.scrollHeight;prompt.value='';busy=true;cancel.disabled=false;controls();status.textContent=t('thinking');
                document.getElementById('assistant-tools').replaceChildren();vscode.postMessage({command:'askAi',question});
            };
            messages.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link){event.preventDefault();vscode.postMessage({command:'openAiLink',url:link.getAttribute('href')});}});
            window.addEventListener('message',event=>{
                const message=event.data;if(!message||typeof message!=='object')return;
                if(message.type==='update'){configured=Boolean(message.aiConfigured&&message.preferences?.['ai.model']);if(dialog.open)labels();}
                else if(message.type==='aiState'){state=message;renderState();}
                else if(message.type==='aiDelta')answer(message);
                else if(message.type==='aiResult'){
                    busy=false;controls();cancel.disabled=false;
                    if(message.answer){answer(message);status.textContent=compatibilityWarning||t('aiReady');}
                    else if(message.error){if(currentReply&&!currentReply.textContent.trim())currentReply.parentElement.remove();entry('error',message.error);status.textContent=message.error;if(!prompt.value)prompt.value=lastQuestion;}
                    currentReply=undefined;
                } else if(message.type==='aiStep'){
                    if(message.name==='compatibility')compatibilityWarning=message.text;
                    const names={get_fleet_status:tr('Refresh GPU status','刷新 GPU 状态'),inspect_task:tr('Trace task process','追查任务进程'),inspect_job:tr('Check scheduler','查询调度器'),inspect_host:tr('Check host resources','检查服务器资源'),read_task_log:tr('Read authorized log','读取授权日志'),manage_reminders:tr('Manage reminders','管理提醒')};
                    const step=node('details','assistant-step');step.append(node('summary','',(names[message.name]||message.name)+' · '+(message.state||'')),node('pre','',message.result||message.text||JSON.stringify(message.args||{},null,2)));document.getElementById('assistant-tools').append(step);
                } else if(message.type==='aiNotice'){status.textContent=message.error||message.text||'';}
                else if(message.type==='aiReset'){busy=false;currentReply=undefined;messages.replaceChildren();labels();}
            });
        })();
    `;
}
export function getAssistantCss(): string {
    return `
        .assistant-dialog { width: min(880px, calc(100vw - 32px)); height: min(720px, calc(100vh - 48px)); max-height: calc(100vh - 48px); }
        .assistant-dialog[open] { display: flex; flex-direction: column; }
        .assistant-dialog .dialog-header { flex: 0 0 auto; padding: 10px 14px; }
        #assistant-sidebar-toggle { display:none; }
        #assistant-server { width:100%; font-size:11px; margin:5px 0 8px; }
        .assistant-dialog .dialog-header .dialog-actions { gap: 4px; }
        .assistant-dialog .dialog-header button { font-size: 11px; min-height: 28px; }
        .assistant-layout { display: grid; grid-template-columns: minmax(0,1fr) 200px; min-height: 0; flex: 1; }
        .assistant-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
        .assistant-messages { overflow: auto; flex: 1; padding: 10px 18px; min-height: 120px; }
        .assistant-messages:empty::after { content: 'GPU Fleet'; display: block; margin-top: 18%; text-align: center; color: var(--vscode-descriptionForeground); font-size: 18px; opacity: .5; }
        .chat-entry { padding: 12px 0; }
        .chat-entry.user { border-bottom: 1px solid var(--vscode-widget-border); }
        .chat-role { display: block; color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 5px; }
        .chat-text { overflow-wrap: anywhere; font-size: 12px; line-height: 1.75; user-select: text; }
        .chat-entry.user .chat-text, .chat-entry.error .chat-text { white-space: pre-wrap; }
        .chat-text > :first-child { margin-top: 0; }
        .chat-text h1,.chat-text h2,.chat-text h3 { font-size: 14px; margin: 16px 0 8px; }
        .chat-text pre { position: relative; overflow: auto; padding: 12px 10px 40px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); line-height: 1.5; }
        .chat-text code { font-size: 11px; background: var(--vscode-textCodeBlock-background); }
        .chat-text pre code { white-space: pre; }
        .code-copy { position: sticky; bottom: 0; left: 0; display: block; font-size: 10px; margin-top: 8px; }
        .chat-text table { display: block; max-width: 100%; overflow: auto; border-collapse: collapse; font-size: 11px; }
        .chat-text td,.chat-text th { padding: 5px 8px; border: 1px solid var(--vscode-widget-border); text-align: left; }
        .chat-text blockquote { margin-left: 0; border-left: 2px solid var(--vscode-widget-border); padding-left: 12px; color: var(--vscode-descriptionForeground); }
        .chat-text a { color: var(--vscode-textLink-foreground); }
        .chat-entry.error .chat-text { color: var(--vscode-editorWarning-foreground); }
        .assistant-form { display: grid; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--vscode-widget-border); font-size: 11px; }
        .assistant-form textarea { width: 100%; resize: vertical; min-height: 62px; max-height: 150px; }
        .assistant-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .assistant-footer .dialog-actions { flex-shrink: 0; }
        #assistant-status { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; max-height: 45px; overflow: auto; }
        .assistant-sidebar { border-left: 1px solid var(--vscode-widget-border); padding: 12px; overflow: auto; font-size: 11px; }
        .assistant-sidebar section,.assistant-sidebar > details { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--vscode-widget-border); }
        .assistant-sidebar h3,.assistant-sidebar summary { font-size: 11px; font-weight: 600; margin: 0 0 8px; }
        .assistant-sidebar .subtle { line-height: 1.6; }
        .assistant-sidebar button { font-size: 10px; min-height: 24px; }
        .context-server,.assistant-watch,.assistant-log { padding: 7px 0; overflow-wrap: anywhere; }
        .assistant-step pre { max-height: 180px; overflow: auto; white-space: pre-wrap; font-size: 10px; }
        @media(max-width:680px) { #assistant-sidebar-toggle { display:inline-flex; } .assistant-sidebar:not(.mobile-open) { display:none; } .assistant-layout { grid-template-columns: minmax(0,1fr); overflow: auto; } .assistant-chat { min-height: 320px; } .assistant-sidebar { border-left: 0; border-top: 1px solid var(--vscode-widget-border); } .assistant-context-section:not([open]) ~ section { display:none; } }
    `;
}
