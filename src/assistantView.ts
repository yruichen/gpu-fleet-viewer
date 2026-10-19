export function getAssistantHtml(): string {
    return `<dialog id="assistant-dialog" class="app-dialog assistant-dialog" aria-labelledby="assistant-title">
        <header class="dialog-header"><h2 id="assistant-title"></h2><button id="assistant-sidebar-toggle" class="secondary-button" type="button" aria-expanded="false"></button><div class="dialog-actions"><button id="assistant-clear" class="secondary-button" type="button"></button><button id="assistant-settings" class="secondary-button" type="button"></button><button id="assistant-close" class="secondary-button" type="button"></button></div></header>
        <div class="assistant-layout"><aside class="assistant-sidebar" aria-label="Conversations">
            <button id="assistant-new-session" class="secondary-button" type="button"></button>
            <h3 id="assistant-sessions-title"></h3><div id="assistant-sessions"></div><p id="assistant-history-note" class="subtle"></p>
            <details class="assistant-reminders-section"><summary id="assistant-reminders-title"></summary><p id="assistant-reminder-help" class="subtle"></p><div id="assistant-reminders"></div></details>
        </aside><div class="assistant-chat">
            <div class="assistant-scopebar"><label for="assistant-server" id="assistant-server-label" class="subtle"></label><select id="assistant-server"></select><span id="assistant-privacy" class="subtle"></span></div>
            <div id="assistant-messages" class="assistant-messages" role="log" aria-label="Conversation"></div>
            <form id="assistant-form" class="assistant-form">
                <label for="assistant-prompt" id="assistant-prompt-label" class="subtle"></label>
                <textarea id="assistant-prompt" rows="3" maxlength="32000" required></textarea>
                <div id="assistant-status" role="status"></div><footer class="assistant-footer"><label class="assistant-permission"><span id="assistant-permission-label"></span><select id="assistant-permission-mode"><option value="confirm"></option><option value="full"></option></select></label><div class="dialog-actions"><button id="assistant-cancel" type="button" class="secondary-button" hidden></button><button id="assistant-send" type="submit"></button></div></footer><span id="assistant-permission-help" class="subtle"></span>
            </form>
        </div></div>
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
            let timer,requestAt=0,currentActivity,resumeButton,lastOutcome='';
            let activity=new Map();const approvalCards=new Map();
            let busy=false,configured=false,currentReply,lastQuestion='',compatibilityWarning='',state={servers:[],reminders:[],sessions:[]},selection,sessionsSignature='',loaded=false,navigating=false;
            function controls(){send.disabled=busy||navigating||!configured;cancel.hidden=!busy;clear.disabled=busy||navigating;prompt.disabled=navigating;document.getElementById('assistant-server').disabled=navigating;document.getElementById('assistant-permission-mode').disabled=navigating||!state.activeId;send.setAttribute('aria-busy',String(busy||navigating));}
            function labels(){
                document.getElementById('assistant-title').textContent=t('assistant');
                document.getElementById('assistant-prompt-label').textContent=tr('Enter to send · Shift+Enter for a new line','Enter 发送 · Shift+Enter 换行');
                prompt.placeholder=tr('Ask about GPUs, task progress, errors or reminders…','询问 GPU、任务进度、异常，或设置提醒…');
                for(const [id,name,label] of [['assistant-settings','settings-2',t('settings')],['assistant-close','x',t('close')],['assistant-clear','trash-2',t('clearChat')],['assistant-send','send',t('sendQuestion')]])document.getElementById(id).replaceChildren(icon(name),document.createTextNode(label));
                cancel.textContent=t('cancelRequest');
                document.getElementById('assistant-sidebar-toggle').textContent=tr('Chats','会话');
                document.getElementById('assistant-new-session').textContent=tr('+ New chat','+ 新对话');
                document.getElementById('assistant-sessions-title').textContent=tr('Conversations','聊天会话');
                document.getElementById('assistant-server-label').textContent=tr('Conversation scope','对话范围');
                document.getElementById('assistant-permission-label').textContent=tr('Permissions','权限');
                document.querySelector('#assistant-permission-mode option[value=confirm]').textContent=tr('Confirm each read','人工确认');
                document.querySelector('#assistant-permission-mode option[value=full]').textContent=tr('Full Access · read-only','Full Access · 只读');
                document.getElementById('assistant-reminder-help').textContent=tr('Runs while desktop VS Code is awake.','需要本机 VS Code 运行且电脑未休眠。');
                if(!busy)setStatus(lastOutcome||(configured?t('aiReady'):t('configureAiFirst')));
                controls();renderState();
            }
            function entry(role,text){
                const section=node('section','chat-entry '+role);
                const heading=node('strong','chat-role');heading.append(icon(role==='user'?'user':'sparkles'),document.createTextNode(role==='user'?t('you'):role==='error'?t('requestError'):t('assistant')));section.append(heading);
                const body=node('div','chat-text',text||'');body.hidden=!text;
                if(role==='assistant'){
                    const group=node('details','activity-group');group.open=true;group.hidden=true;
                    const summary=node('summary','activity-summary');summary.append(icon('terminal'),node('span','activity-summary-label',tr('Operation activity','执行过程')));
                    const steps=node('div','chat-activity');steps.setAttribute('aria-label',tr('Operation activity','操作过程'));group.append(summary,steps);section.append(group);
                }
                section.append(body);messages.append(section);
                while(messages.childElementCount>32)messages.firstElementChild.remove();return body;
            }
            function nearBottom(){return messages.scrollHeight-messages.scrollTop-messages.clientHeight<70;}
            function answer(message){
                const follow=nearBottom();
                if(!currentReply||!currentReply.isConnected)currentReply=entry('assistant','');
                currentReply.hidden=false;
                if(typeof message.html==='string')currentReply.innerHTML=message.html;else currentReply.textContent=message.answer||'';
                for(const pre of currentReply.querySelectorAll('pre')){
                    const copy=button(t('copy'),'code-copy secondary-button',()=>vscode.postMessage({command:'copyAiText',text:pre.querySelector('code')?.textContent||''}));pre.append(copy);
                }
                if(follow)messages.scrollTop=messages.scrollHeight;
            }
            const statusLabel=node('span');const statusTime=node('span','assistant-status-elapsed');statusTime.setAttribute('aria-hidden','true');status.replaceChildren(statusLabel,statusTime);
            function setStatus(value){if(statusLabel.textContent!==value)statusLabel.textContent=value;}
            function toolLabel(name,args={}){
                const server=state.servers.find(s=>s.id===args.server)?.label||args.server||'';
                const names={get_fleet_status:tr('Refresh GPU status','刷新 GPU 状态'),inspect_task:tr('Inspect task','查询任务'),inspect_job:tr('Inspect Slurm job','查询 Slurm 作业'),inspect_host:tr('Inspect host resources','检查服务器资源'),list_task_files:tr('Explore task directory','查看任务目录'),read_task_log:tr('Read task text','读取任务文件'),manage_reminders:tr('Manage reminder','处理提醒')};
                return (names[name]||name)+(server?' · '+server:'')+(args.pid?' · PID '+args.pid:'')+(args.job?' · '+args.job:'')+(args.path?' · '+args.path:'');
            }
            function activityLabel(step){
                if(step.state==='blocked'&&step.phase==='approval')return tr('Waiting for your file authorization','等待你授权读取文件');
                if(step.name)return toolLabel(step.name,step.args);
                const phases={preparing:tr('Prepare context and request','准备上下文和请求'),connecting:tr('Connect to AI service','连接 AI 服务'),waiting:tr('Request sent · waiting for model response','请求已发送，等待模型响应'),receiving:tr('Response received · waiting for content','已收到响应，等待内容'),generating:tr('Generating answer','正在生成回答'),tool:tr('Model preparing a tool call','模型正在准备工具调用'),approval:tr('Waiting for your authorization','等待你的授权')};
                if(step.state==='done')return step.phase==='preparing'?tr('Context prepared','上下文已准备'):tr('Model response received','模型已返回结果');
                return (phases[step.phase]||tr('Processing','处理中'))+(step.toolName?' · '+toolLabel(step.toolName):'')+(step.endpoint&&step.phase!=='generating'?' · '+step.endpoint:'');
            }
            function renderActivity(step){
                step.element.dataset.state=step.state;
                const badges={running:tr('In progress','进行中'),done:tr('Done','完成'),error:tr('Failed','失败'),cancelled:tr('Cancelled','已取消'),blocked:tr('Needs authorization','需要授权'),denied:tr('Declined','已拒绝')};
                step.label.textContent=activityLabel(step);step.badge.textContent=badges[step.state]||'';
                step.duration.textContent=Math.max(0,Math.floor(((step.finishedAt||Date.now())-step.startedAt)/1000))+tr('s',' 秒');
                const detail=step.result||step.error||step.text||step.argumentText||[step.endpoint,step.model].filter(Boolean).join(' · ');
                if(step.details.textContent!==detail)step.details.textContent=detail||'';
            }
            function tickActivity(){
                for(const step of activity.values())if(step.state==='running')renderActivity(step);
                if(busy&&currentActivity)setStatus(activityLabel(currentActivity));
                const elapsed=requestAt?Math.max(0,Math.floor((Date.now()-requestAt)/1000)):0;
                statusTime.textContent=requestAt?' · '+elapsed+tr('s elapsed',' 秒'):'';
                const group=currentReply?.parentElement.querySelector('.activity-group');
                if(group)group.querySelector('.activity-summary-label').textContent=(busy?tr('Operation activity','执行过程'):tr('View operation activity','查看执行过程'))+' · '+(group.dataset.count||0)+tr(' records',' 条记录')+' · '+elapsed+tr('s',' 秒');
            }
            function pruneActivity(){
                const rows=Array.from(messages.querySelectorAll('.assistant-step:not([data-state=running]):not([data-state=blocked]), .ai-approval[data-settled]'));
                for(const row of rows.slice(0,Math.max(0,rows.length-80))){
                    const parent=row.parentElement;let notice=parent.querySelector('.activity-compacted');
                    if(!notice){notice=node('p','subtle activity-compacted');parent.prepend(notice);}
                    notice.dataset.count=String(Number(notice.dataset.count||0)+1);
                    notice.textContent=tr('Earlier activity records removed from view: ','较早的过程记录已从界面移除：')+notice.dataset.count;
                    for(const [id,step] of activity)if(step.element===row)activity.delete(id);
                    row.remove();
                }
            }
            function recordActivity(message){
                const follow=nearBottom();
                if(!currentReply||!currentReply.isConnected)currentReply=entry('assistant','');
                const id=message.id||message.name||'model';let step=activity.get(id);
                if(!step){
                    const group=currentReply.parentElement.querySelector('.activity-group');group.hidden=false;group.dataset.count=String(Number(group.dataset.count||0)+1);
                    const element=node('details','assistant-step');const summary=node('summary');
                    const indicator=node('span','step-indicator');indicator.setAttribute('aria-hidden','true');
                    const label=node('span','step-label'),badge=node('span','step-badge'),duration=node('span','step-duration');duration.setAttribute('aria-hidden','true');
                    const details=node('pre');summary.append(indicator,label,badge,duration);element.append(summary,details);
                    currentReply.parentElement.querySelector('.chat-activity').append(element);
                    step={id,element,label,badge,duration,details,startedAt:message.startedAt||Date.now(),state:'running'};activity.set(id,step);
                }
                for(const [key,value] of Object.entries(message)){
                    if(value===undefined)continue;
                    if(key==='args'){
                        step.argumentText=JSON.stringify(value,null,2).slice(0,8192);
                        step.args=Object.fromEntries(['server','pid','job','path'].filter(k=>typeof value[k]==='string').map(k=>[k,value[k].slice(0,512)]));
                    }else step[key]=typeof value==='string'&&value.length>16384?value.slice(0,8192)+'\\n…'+tr('Display excerpt; older details omitted','界面仅显示摘录，部分详情已省略')+'…\\n'+value.slice(-8192):value;
                }
                if(step.state==='running')step.finishedAt=undefined;
                if(step.state!=='running'&&!step.finishedAt)step.finishedAt=Date.now();
                currentActivity=step;renderActivity(step);pruneActivity();tickActivity();if(follow)messages.scrollTop=messages.scrollHeight;
            }
            function beginActivity(){
                clearInterval(timer);activity=new Map();requestAt=Date.now();lastOutcome='';
                recordActivity({id:'prepare',phase:'preparing',state:'running',startedAt:requestAt});timer=setInterval(tickActivity,1000);
            }
            function finishActivity(state){
                clearInterval(timer);for(const step of activity.values())if(step.state==='running'||step.state==='blocked'){step.state=state;step.finishedAt=Date.now();renderActivity(step);}
                tickActivity();
            }
            function approvalCard(message){
                recordActivity({id:message.operationId,phase:'approval',state:'blocked'});
                currentReply.parentElement.querySelector('.activity-group').open=true;
                const card=node('section','ai-approval');card.setAttribute('aria-label',tr('Task file authorization','任务文件读取授权'));
                card.append(node('strong','',tr('Read task file','读取任务文件')),node('span','subtle block',message.label||message.server),node('code','block',message.path),
                    node('p','subtle',(message.view==='head'?tr('Read the beginning, up to ','读取开头，最多 '):tr('Read the tail, up to ','读取末尾，最多 '))+message.maxLines+tr(' lines / ',' 行 / ')+Math.round(message.maxBytes/1024)+' KiB'+tr(', sent to ', '，发送至 ')+message.endpoint));
                const actions=node('div','dialog-actions');
                for(const [decision,label] of [['once',tr('Allow once and continue','允许本次并继续')],['deny',tr('Decline','拒绝')]]){
                    actions.append(button(label,decision==='once'?'':'secondary-button',()=>{for(const b of actions.querySelectorAll('button'))b.disabled=true;vscode.postMessage({command:'resolveAiApproval',id:message.id,decision});}));
                }
                card.append(actions);currentReply.parentElement.querySelector('.chat-activity').append(card);approvalCards.set(message.id,{card,actions});
                messages.scrollTop=messages.scrollHeight;
            }
            function startTurn(question,continuing=false){
                if(busy||navigating||!configured)return;
                if(resumeButton)resumeButton.disabled=true;
                compatibilityWarning='';lastQuestion=question;entry('user',continuing?tr('Continue investigation','继续查询'):question);currentReply=entry('assistant','');
                messages.scrollTop=messages.scrollHeight;prompt.value='';busy=true;cancel.disabled=false;controls();beginActivity();
                vscode.postMessage(continuing?{command:'continueAi'}:{command:'askAi',question});
            }
            function continuationCard(message){
                const card=node('section','ai-continuation');
                const text=message.paused?tr('This turn reached your configured budget. Completed queries are saved.','已达到你设置的本轮预算，已完成的查询结果均已保留。'):tr('Completed queries are saved. Retry from the current operation.','已保留已完成的查询，可从当前操作继续。');
                card.append(node('p','subtle',text));
                resumeButton=button(message.paused?tr('Continue investigation','继续查询'):tr('Retry and continue','重试并继续'),'',()=>startTurn(lastQuestion,true));card.append(resumeButton);messages.append(card);
            }
            function renderState(){
                const serverSelect=document.getElementById('assistant-server');
                const options=document.createDocumentFragment();const all=node('option','',tr('Dashboard scope','仪表盘范围'));all.value='';options.append(all);
                for(const server of state.servers){const option=node('option','',server.label);option.value=server.id;options.append(option);}
                patchChildren(serverSelect,options);serverSelect.value=state.scope?.server||'';
                const selected=state.servers.find(s=>s.id===state.scope?.server);
                serverSelect.title=selected?selected.label+(state.scope.uuid?' · '+state.scope.uuid:'')+(state.scope.pid?' · PID '+state.scope.pid:''):tr('Visible dashboard GPUs','仪表盘中显示的 GPU');
                document.getElementById('assistant-privacy').textContent=tr('Local SSH · Data is sent to ','本机 SSH · 提问时数据发送至 ')+(state.endpoint||tr('your API','所配 API'));
                document.getElementById('assistant-permission-mode').value=state.permissionMode||'confirm';
                document.getElementById('assistant-permission-mode').dataset.mode=state.permissionMode||'confirm';
                document.getElementById('assistant-permission-help').textContent=state.permissionMode==='full'?tr('Automatically reads discovered task files and sends text to your API. Read-only tools and sensitive-path protection still apply.','自动读取已发现的任务文件并发送至所配 API；仍受只读工具和敏感路径保护。'):tr('Each task-file read requires your approval.','每次读取任务文件前，由你确认。');
                document.getElementById('assistant-history-note').textContent=state.savedHistory?tr('Conversation text saved locally. Restored with confirmation required.','聊天正文保存在本机；恢复后使用人工确认。'):tr('Window-only chats. Enable local history in Settings → AI.','会话仅保留在当前窗口，可在设置 → AI 中开启本机保存。');
                document.getElementById('assistant-reminders-title').textContent=tr('Reminders','我的提醒')+' · '+state.reminders.filter(w=>w.status==='active').length;
                renderSessions();
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
            }
            function renderSessions(){
                const signature=JSON.stringify([state.sessions,state.activeId,language]);if(signature===sessionsSignature)return;sessionsSignature=signature;
                const root=document.getElementById('assistant-sessions'),fragment=document.createDocumentFragment();
                for(const session of state.sessions||[]){
                    const row=node('div','assistant-session');row.dataset.key=session.id;
                    const select=button(session.title||tr('New chat','新对话'),'session-select',()=>navigate('switchAiSession',session.id));select.setAttribute('aria-pressed',String(session.id===state.activeId));select.title=tr('Switching stops the current reply. Completed work is kept.','切换会停止当前回答，保留已完成的内容。');
                    const menu=node('details','session-menu');menu.id='session-menu-'+session.id;menu.open=Boolean(document.getElementById(menu.id)?.open);
                    const toggle=node('summary','', '⋯');toggle.setAttribute('aria-label',tr('Manage conversation','管理会话'));menu.append(toggle);
                    const actions=node('div','session-menu-actions');const name=node('input');name.id='session-name-'+session.id;name.value=session.title;name.maxLength=80;name.setAttribute('aria-label',tr('Conversation title','会话名称'));
                    actions.append(name,button(tr('Rename','重命名'),'secondary-button',()=>{const title=document.getElementById(name.id).value.trim();if(title)vscode.postMessage({command:'renameAiSession',id:session.id,title});}),button(tr('Delete','删除'),'text-button',()=>{
                        const current=document.getElementById('session-delete-'+session.id);
                        if(current.dataset.confirm==='yes')navigate('deleteAiSession',session.id);else {current.dataset.confirm='yes';current.textContent=tr('Confirm delete','确认删除');}
                    }));actions.lastChild.id='session-delete-'+session.id;menu.append(actions);row.append(select,menu);fragment.append(row);
                }
                patchChildren(root,fragment);
            }
            function navigate(command,id){if(navigating)return;if(command!=='deleteAiSession'||id===state.activeId){navigating=true;controls();setStatus(tr('Switching conversation…','正在切换会话…'));}document.querySelector('.assistant-sidebar').classList.remove('mobile-open');document.getElementById('assistant-sidebar-toggle').setAttribute('aria-expanded','false');vscode.postMessage({command,id,draft:prompt.value});}
            function resetDisplay(){clearInterval(timer);activity=new Map();approvalCards.clear();requestAt=0;lastOutcome='';statusTime.textContent='';messages.replaceChildren();currentReply=undefined;resumeButton=undefined;currentActivity=undefined;}
            function loadSession(message){
                const openingQuestion=!loaded?prompt.value:'';loaded=true;navigating=false;
                busy=false;resetDisplay();selection=undefined;state.activeId=message.id;state.permissionMode=message.permissionMode;prompt.value=openingQuestion||message.draft||'';
                for(const item of message.messages||[]){if(item.role==='assistant'){currentReply=entry('assistant','');answer({answer:item.content,html:item.html});currentReply=undefined;}else entry(item.role,item.content);}
                lastQuestion=[...(message.messages||[])].reverse().find(m=>m.role==='user')?.content||'';
                if(message.canContinue)continuationCard({});messages.scrollTop=messages.scrollHeight;controls();renderState();prompt.focus();
            }
            window.addEventListener('openAssistant',event=>{
                selection=event.detail||selection;
                if(selection?.question)prompt.value=selection.question;
                labels();if(!dialog.open)openDialog(dialog);prompt.focus();
                if(!loaded){navigating=true;controls();}vscode.postMessage({command:'aiState',host:selection?.host,uuid:selection?.uuid,pid:selection?.pid,load:!loaded});
            });
            document.getElementById('assistant-sidebar-toggle').onclick=()=>{const open=document.querySelector('.assistant-sidebar').classList.toggle('mobile-open');document.getElementById('assistant-sidebar-toggle').setAttribute('aria-expanded',String(open));};
            document.getElementById('assistant-server').onchange=event=>{selection=undefined;vscode.postMessage({command:'aiState',scopeServer:event.target.value||null});};
            document.getElementById('assistant-close').onclick=()=>closeDialog(dialog);
            document.getElementById('assistant-settings').onclick=()=>{closeDialog(dialog);document.getElementById('preferences-dialog').addEventListener('close',()=>{labels();openDialog(dialog);prompt.focus();},{once:true});window.dispatchEvent(new CustomEvent('openPreferences',{detail:'ai'}));};
            document.getElementById('assistant-new-session').onclick=()=>navigate('newAiSession');
            document.getElementById('assistant-permission-mode').onchange=event=>vscode.postMessage({command:'setAiPermissionMode',sessionId:state.activeId,mode:event.target.value});
            cancel.onclick=()=>{cancel.disabled=true;setStatus(tr('Cancelling…','正在取消…'));vscode.postMessage({command:'cancelAi'});};
            clear.onclick=()=>navigate('clearAi');
            prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!busy)document.getElementById('assistant-form').requestSubmit();}});
            document.getElementById('assistant-form').onsubmit=event=>{
                event.preventDefault();const question=prompt.value.trim();if(busy||!configured||!question)return;
                startTurn(question);
            };
            messages.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link){event.preventDefault();vscode.postMessage({command:'openAiLink',url:link.getAttribute('href')});}});
            window.addEventListener('message',event=>{
                const message=event.data;if(!message||typeof message!=='object')return;
                if(message.type==='update'){configured=Boolean(message.aiConfigured&&message.preferences?.['ai.model']);if(dialog.open)labels();}
                else if(message.type==='aiState'){state=message;renderState();controls();}
                else if(message.type==='aiSession')loadSession(message);
                else if(message.type==='aiNavigationStart'){navigating=true;controls();setStatus(tr('Switching conversation…','正在切换会话…'));}
                else if(message.type==='aiApproval')approvalCard(message);
                else if(message.type==='aiApprovalResult'){const item=approvalCards.get(message.id);if(item){item.actions.replaceChildren(node('span','subtle',message.decision==='deny'?tr('Declined · continuing with other evidence','已拒绝，将使用其他证据'):message.decision==='cancelled'?tr('Cancelled','已取消'):tr('Allowed · continuing automatically','已允许，自动继续查询')));item.card.dataset.settled='true';approvalCards.delete(message.id);pruneActivity();}}
                else if(message.type==='aiActivity')recordActivity(message);
                else if(message.type==='aiCapability'){
                    if(!currentReply)currentReply=entry('assistant','');
                    const warning=node('p','ai-capability-warning',message.text);warning.setAttribute('role','status');currentReply.before(warning);
                }
                else if(message.type==='aiDelta')answer(message);
                else if(message.type==='aiResult'){
                    busy=false;finishActivity(message.error?(/cancel/i.test(message.error)?'cancelled':'error'):'done');controls();cancel.disabled=false;
                    if(message.answer){answer(message);lastOutcome=compatibilityWarning||t('aiReady');setStatus(lastOutcome);}
                    else if(message.error){
                        const codes={ENOTFOUND:tr('Cannot resolve API hostname','无法解析 API 域名'),EAI_AGAIN:tr('Temporary DNS failure','DNS 解析暂时失败'),ECONNRESET:tr('API connection reset','API 连接被重置'),ECONNREFUSED:tr('API connection refused','API 连接被拒绝'),ETIMEDOUT:tr('API request timed out','API 请求超时')};
                        if(message.code&&codes[message.code])message.error=codes[message.code]+' ('+message.code+') · '+message.error;
                        if(currentReply&&!currentReply.textContent.trim())currentReply.hidden=true;entry('error',message.error);lastOutcome=message.error;setStatus(lastOutcome);if(!prompt.value)prompt.value=lastQuestion;}
                    if(message.paused){lastOutcome=tr('Paused at your configured budget','已按你设置的预算暂停');setStatus(lastOutcome);}
                    if(message.canContinue)continuationCard(message);
                    if(!message.error&&!message.paused&&currentReply)currentReply.parentElement.querySelector('.activity-group').open=false;
                    currentReply=undefined;
                } else if(message.type==='aiStep'){
                    if(message.name==='compatibility')compatibilityWarning=message.text;
                    recordActivity(message);
                } else if(message.type==='aiNavigationError'){navigating=false;controls();lastOutcome=message.error;setStatus(lastOutcome);}
                else if(message.type==='aiNotice'){lastOutcome=message.error||message.text||'';setStatus(lastOutcome);}
                else if(message.type==='aiReset'){busy=false;finishActivity('cancelled');activity=new Map();approvalCards.clear();lastOutcome='';requestAt=0;statusTime.textContent='';currentReply=undefined;resumeButton=undefined;messages.replaceChildren();labels();}
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
        #assistant-server { width:100%; min-width:0; font-size:11px; }
        .assistant-dialog .dialog-header .dialog-actions { gap: 4px; }
        .assistant-dialog .dialog-header button { font-size: 11px; min-height: 28px; }
        .assistant-layout { display:grid; grid-template-columns:190px minmax(0,1fr); min-height:0; flex:1; }
        .assistant-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
        .assistant-scopebar { display:grid; grid-template-columns:auto minmax(90px,150px); align-items:center; gap:5px 8px; padding:8px 14px; border-bottom:1px solid var(--vscode-widget-border); }
        #assistant-privacy { grid-column:1/-1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .assistant-messages { overflow: auto; flex: 1; padding: 10px 18px; min-height: 120px; }
        .assistant-messages:empty::after { content: 'GPU Fleet'; display: block; margin-top: 18%; text-align: center; color: var(--vscode-descriptionForeground); font-size: 18px; opacity: .5; }
        .chat-entry { padding:16px 0; min-width:0; }
        .chat-entry.user { margin:12px 0 4px 28px; padding:10px 13px; border:1px solid var(--vscode-widget-border); border-radius:10px 10px 3px 10px; background:color-mix(in srgb,var(--vscode-foreground) 5%,var(--vscode-editor-background)); }
        .chat-entry.assistant { margin-right:8px; }
        .chat-role { display:flex; align-items:center; gap:6px; color:var(--vscode-descriptionForeground); font-size:10px; font-weight:500; margin-bottom:8px; }
        .chat-role .icon { width:13px; height:13px; flex-basis:13px; }
        .chat-entry.assistant .chat-role { color:var(--vscode-foreground); font-weight:600; }
        .chat-entry.assistant .chat-role .icon { color:var(--vscode-textLink-foreground); }
        .chat-text { overflow-wrap:anywhere; font-size:12px; line-height:1.8; user-select:text; }
        .chat-entry.user .chat-text { line-height:1.6; }
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
        .chat-entry.error { border-left:2px solid var(--vscode-editorWarning-foreground); padding:8px 12px; margin:8px 0; }
        .chat-entry.error .chat-text { color: var(--vscode-editorWarning-foreground); }
        .assistant-form { display: grid; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--vscode-widget-border); font-size: 11px; }
        .assistant-form textarea { width: 100%; resize: vertical; min-height: 62px; max-height: 150px; }
        .assistant-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .assistant-footer .dialog-actions { flex-shrink: 0; }
        #assistant-status { color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; max-height: 45px; overflow: auto; }
        .assistant-sidebar { display:flex; flex-direction:column; min-height:0; border-right:1px solid var(--vscode-widget-border); padding:12px 10px; overflow:auto; font-size:11px; background:var(--vscode-sideBar-background); }
        #assistant-new-session { width:100%; margin-bottom:16px; text-align:left; }
        #assistant-sessions { flex:1; min-height:90px; overflow:auto; }
        .assistant-session { display:flex; align-items:center; gap:2px; border-radius:4px; }
        .session-select { min-width:0; flex:1; padding:7px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; color:var(--vscode-descriptionForeground); background:transparent; }
        .session-select:hover { background:var(--vscode-list-hoverBackground); }
        .session-select[aria-pressed=true] { color:var(--vscode-foreground); background:var(--vscode-list-inactiveSelectionBackground,var(--vscode-button-secondaryBackground)); }
        .session-menu { position:relative; flex-shrink:0; }
        .session-menu > summary { cursor:pointer; padding:4px; list-style:none; font-size:16px; }
        .session-menu-actions { position:absolute; z-index:3; top:100%; right:0; display:grid; gap:6px; width:160px; padding:8px; background:var(--vscode-editor-background); border:1px solid var(--vscode-widget-border); border-radius:5px; box-shadow:0 4px 12px var(--vscode-widget-shadow); }
        .session-menu-actions input { min-width:0; width:100%; font-size:11px; }
        #assistant-history-note { font-size:10px; line-height:1.6; padding:8px 0; }
        .assistant-reminders-section { flex-shrink:0; max-height:190px; overflow:auto; }
        .assistant-permission { display:flex; align-items:center; gap:6px; color:var(--vscode-descriptionForeground); }
        #assistant-permission-mode { max-width:190px; font-size:11px; min-height:27px; }
        #assistant-permission-mode[data-mode=full] { border-color:var(--vscode-editorWarning-foreground); }
        #assistant-permission-help { font-size:10px; line-height:1.5; }
        .assistant-sidebar section,.assistant-sidebar > details { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--vscode-widget-border); }
        .assistant-sidebar h3,.assistant-sidebar summary { font-size: 11px; font-weight: 600; margin: 0 0 8px; }
        .assistant-sidebar .subtle { line-height: 1.6; }
        .assistant-sidebar button { font-size: 10px; min-height: 24px; }
        .assistant-watch { padding: 7px 0; overflow-wrap: anywhere; }
        .ai-continuation { padding:10px 0; border-top:1px solid var(--vscode-widget-border); font-size:12px; }
        .ai-approval { border:1px solid var(--vscode-widget-border); border-radius:5px; padding:12px; margin:6px 0; }
        .ai-approval code { margin:7px 0; overflow-wrap:anywhere; white-space:pre-wrap; }
        .ai-approval .dialog-actions { gap:6px; }
        .ai-approval button { font-size:11px; }
        .chat-activity { display:grid; gap:6px; margin:0 0 10px; }
        .activity-group { margin:0 0 10px; min-width:0; }
        .activity-group[hidden] { display:none; }
        .activity-summary { display:flex; align-items:center; gap:7px; min-height:28px; color:var(--vscode-descriptionForeground); font-size:11px; cursor:pointer; list-style:none; }
        .activity-summary::after { content:'›'; margin-left:auto; font-size:16px; transform:rotate(0deg); }
        .activity-group[open] > .activity-summary::after { transform:rotate(90deg); }
        .activity-group[open] > .activity-summary { margin-bottom:8px; }
        .activity-summary:hover { color:var(--vscode-foreground); }
        .ai-capability-warning { border-left:2px solid var(--vscode-editorWarning-foreground); padding:8px 10px; color:var(--vscode-editorWarning-foreground); font-size:11px; line-height:1.6; }
        .assistant-step { min-width:0; border-left:2px solid var(--vscode-widget-border); padding-left:8px; font-size:11px; }
        .assistant-step summary { display:flex; align-items:center; gap:7px; cursor:pointer; min-height:24px; list-style:none; }
        .step-label { flex:1; min-width:0; overflow-wrap:anywhere; color:var(--vscode-descriptionForeground); }
        .step-badge,.step-duration { flex-shrink:0; color:var(--vscode-descriptionForeground); font-size:10px; }
        .step-indicator { width:10px; height:10px; border:1px solid var(--vscode-descriptionForeground); border-radius:50%; flex-shrink:0; }
        .assistant-step[data-state=running] .step-indicator { border-color:var(--vscode-widget-border); border-top-color:var(--vscode-focusBorder); animation:activity-spin 1s linear infinite; }
        .assistant-step[data-state=done] .step-indicator { background:var(--vscode-descriptionForeground); opacity:.5; }
        .assistant-step[data-state=error],.assistant-step[data-state=blocked] { border-left-color:var(--vscode-editorWarning-foreground); }
        .assistant-status-elapsed { white-space:nowrap; }
        @keyframes activity-spin { to { transform:rotate(360deg); } }
        @media(prefers-reduced-motion:reduce) { .assistant-step[data-state=running] .step-indicator { animation:none; } }
        .assistant-step pre { max-height: 180px; overflow: auto; white-space: pre-wrap; font-size: 10px; }
        @media(max-width:680px) { #assistant-sidebar-toggle { display:inline-flex; } .assistant-sidebar:not(.mobile-open) { display:none; } .assistant-layout { grid-template-columns:minmax(0,1fr); overflow:auto; } .assistant-chat { min-height:320px; } .assistant-sidebar { max-height:240px; border-right:0; border-bottom:1px solid var(--vscode-widget-border); } .assistant-permission { gap:4px; } #assistant-permission-mode { max-width:155px; } }
    `;
}
