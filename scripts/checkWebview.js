const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

async function main() {
    const html = fs.readFileSync(path.join(__dirname, '..', 'preview', 'index.html'), 'utf8');
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => errors.push(error));
    virtualConsole.on('error', error => errors.push(error));

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        virtualConsole
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(dom.window.document.querySelectorAll('.server-band').length, 4);
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile').length, 14);
    assert.ok(dom.window.document.querySelectorAll('.host-health').length >= 4);
    assert.match(dom.window.document.getElementById('refresh-state').textContent, /^Updated /);

    assert.strictEqual(dom.window.document.getElementById('language-button'),null,'Language belongs in settings, not the main toolbar.');
    dom.window.document.getElementById('settings-button').click();
    const languagePreference=dom.window.document.getElementById('pref-language');
    languagePreference.value='zh-CN';languagePreference.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    dom.window.document.getElementById('preferences-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await new Promise(resolve => setTimeout(resolve, 10));
    dom.window.document.getElementById('preferences-close').click();
    assert.strictEqual(dom.window.document.getElementById('page-title').textContent,'GPU Fleet');
    assert.strictEqual(dom.window.document.querySelectorAll('.summary-meter').length,3,'Only continuous resource metrics need progress tracks.');
    assert.strictEqual(dom.window.document.querySelectorAll('.user-chip.active').length,1,'Unselected users must not share the selected state.');
    dom.window.document.querySelector('.summary-filter[data-filter=available]').click();
    assert.strictEqual(dom.window.document.getElementById('status-filter').value,'available');
    assert.strictEqual(dom.window.document.getElementById('reset-filters-button').hidden,false);
    dom.window.document.getElementById('reset-filters-button').click();
    assert.strictEqual(dom.window.document.getElementById('reset-filters-button').hidden,true);
    assert.strictEqual(dom.window.document.getElementById('settings-button').textContent, '设置');
    assert.strictEqual(dom.window.document.querySelector('#status-filter option[value="available"]').textContent, '可用');
    assert.match(dom.window.document.getElementById('refresh-state').textContent, /^更新于 /);

    dom.window.postMessage({
        type: 'refreshState', state: 'refreshing', completed: 2, total: 4, language: 'zh-CN'
    }, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(dom.window.document.getElementById('refresh-button').disabled, false);
    assert.ok(dom.window.document.getElementById('refresh-button').classList.contains('refreshing'));
    assert.match(dom.window.document.getElementById('refresh-state').textContent, /2\/4$/);

    dom.window.document.querySelectorAll('.server-band')[2].querySelectorAll('.gpu-main')[1].click();
    const selectedBand = dom.window.document.querySelectorAll('.server-band')[2];
    const detailSidebar=dom.window.document.getElementById('gpu-details');
    assert.strictEqual(selectedBand.querySelectorAll('.process-inspector').length, 0,'GPU details must not expand the server list.');
    assert.strictEqual(detailSidebar.hidden,false);
    assert.strictEqual(detailSidebar.querySelectorAll('.process-inspector').length, 1);
    assert.strictEqual(detailSidebar.querySelectorAll('.task-row').length, 7);
    const focusedGpu = selectedBand.querySelectorAll('.gpu-main')[1];
    assert.strictEqual(focusedGpu.getAttribute('aria-controls'),'gpu-details');
    assert.strictEqual(focusedGpu.getAttribute('aria-expanded'),'true');
    focusedGpu.focus();
    const processScroll = detailSidebar.querySelector('.process-scroll');
    processScroll.scrollTop = 80;
    detailSidebar.scrollTop=60;
    const processRow = detailSidebar.querySelector('.task-row');
    dom.window.__gpuPreview.data[2].gpus[1].processes[0].elapsedSeconds = 18500;
    dom.window.postMessage(dom.window.__gpuPreview, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(selectedBand.isConnected, 'Refreshing must retain the server section.');
    assert.strictEqual(dom.window.document.activeElement, focusedGpu, 'Refreshing must retain keyboard focus.');
    assert.strictEqual(detailSidebar.querySelector('.process-scroll'), processScroll);
    assert.strictEqual(processScroll.scrollTop, 80, 'Refreshing must retain inspector scroll position.');
    assert.strictEqual(detailSidebar.scrollTop,60);
    assert.strictEqual(detailSidebar.querySelector('.task-row'), processRow);
    detailSidebar.querySelector('.inspector-header button').click();
    assert.strictEqual(dom.window.document.querySelectorAll('.process-inspector').length, 0);
    assert.strictEqual(detailSidebar.hidden,true);
    assert.strictEqual(dom.window.document.activeElement,focusedGpu,'Closing details must restore focus to its GPU.');
    focusedGpu.click();
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.strictEqual(detailSidebar.hidden,true,'Escape must close the detail drawer.');

    const search = dom.window.document.getElementById('search-input');
    search.value = '4090';
    search.dispatchEvent(new dom.window.Event('input'));
    assert.strictEqual(dom.window.document.querySelectorAll('.server-band').length, 1);
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile').length, 2);
    dom.window.postMessage({ type: 'refreshState', state: 'refreshing', completed: 1, total: 4 }, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    search.value = '409';
    search.dispatchEvent(new dom.window.Event('input'));
    assert.match(dom.window.document.getElementById('refresh-state').textContent, /1\/4$/, 'Filtering must retain refresh progress.');
    search.value = '';
    search.dispatchEvent(new dom.window.Event('input'));

    const status = dom.window.document.getElementById('status-filter');
    status.value = 'available';
    status.dispatchEvent(new dom.window.Event('change'));
    assert.ok(dom.window.document.querySelectorAll('.gpu-tile.available').length > 0);
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile.busy').length, 0);

    status.value = 'all';
    status.dispatchEvent(new dom.window.Event('change'));
    const minMemory = dom.window.document.getElementById('min-memory');
    const minGpus = dom.window.document.getElementById('min-gpus');
    minMemory.value = '40';
    minMemory.dispatchEvent(new dom.window.Event('input'));
    minGpus.value = '2';
    minGpus.dispatchEvent(new dom.window.Event('input'));
    assert.strictEqual(dom.window.document.querySelectorAll('.server-band').length, 2, 'Find two GPUs with at least 40 GiB each on one server.');
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile').length, 4);
    minGpus.value = '3';
    minGpus.dispatchEvent(new dom.window.Event('input'));
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile').length, 0);
    dom.window.document.getElementById('reset-filters-button').click();
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile').length, 14);
    dom.window.document.getElementById('my-tasks-button').click();
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile').length, 3);
    dom.window.document.getElementById('reset-filters-button').click();

    dom.window.document.getElementById('settings-button').click();
    const preferences = dom.window.document.getElementById('preferences-dialog');
    assert.strictEqual(preferences.open, true);
    const gpuScope=dom.window.document.getElementById('pref-visibleGpus');
    assert.ok(gpuScope.querySelectorAll('.gpu-scope-card').length>=4);
    const firstCard=gpuScope.querySelector('.gpu-scope-card');
    const firstGpu=firstCard.querySelector('.gpu-scope-choices input');
    firstGpu.checked=false;firstGpu.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    dom.window.document.getElementById('preferences-close').click();
    assert.strictEqual(preferences.open,true,'Unsaved scope edits must not be silently discarded.');
    assert.strictEqual(dom.window.document.getElementById('preferences-discard').hidden,false);
    dom.window.document.getElementById('preferences-discard').click();
    assert.strictEqual(preferences.open,false);
    dom.window.document.getElementById('settings-button').click();
    const interval = dom.window.document.getElementById('pref-refreshInterval');
    interval.value = '12';
    interval.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    dom.window.postMessage(dom.window.__gpuPreview, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(dom.window.document.getElementById('pref-refreshInterval'), interval);
    assert.strictEqual(interval.value, '12', 'Metric refresh must retain unsaved settings.');
    dom.window.document.getElementById('preferences-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 10));
    const saved = dom.window.__gpuMessages.findLast(message => message.command === 'savePreferences');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(saved.values)), { refreshInterval: 12 }, 'Only edited fields should be saved.');
    dom.window.document.getElementById('preferences-close').click();
    assert.strictEqual(preferences.open, false);

    dom.window.document.getElementById('assistant-button').click();
    const assistant = dom.window.document.getElementById('assistant-dialog');
    assert.strictEqual(assistant.open, true);
    assert.strictEqual(dom.window.__gpuMessages.filter(message => message.command === 'askAi').length, 0);
    assert.ok(assistant.querySelector('.assistant-sidebar'));
    assert.strictEqual(assistant.querySelectorAll('input[type=checkbox]').length,0);
    assert.ok(dom.window.document.querySelector('.server-band'), 'Opening chat must retain the dashboard.');
    const { renderMarkdown } = require('../out/markdown');
    const markdown='<img src=x onerror=alert(1)>\n\n**GPU ready**\n\n| GPU | Free |\n| --- | --- |\n| 0 | yes |\n\n```sh\nnvidia-smi\n```\n\n[x](command:danger) [docs](https://example.com)';
    dom.window.postMessage({ type: 'aiResult', answer: markdown, html:renderMarkdown(markdown) }, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(assistant.querySelectorAll('.chat-text img').length, 0, 'Raw model HTML must not execute.');
    assert.ok(assistant.querySelector('.chat-text').textContent.includes('<img'));
    assert.strictEqual(assistant.querySelector('.chat-text strong').textContent,'GPU ready');
    assert.strictEqual(assistant.querySelectorAll('.chat-text table').length,1);
    assert.strictEqual(assistant.querySelectorAll('.chat-text pre code').length,1);
    assert.strictEqual(assistant.querySelectorAll('a[href^="command:"]').length,0);
    assert.ok(assistant.querySelector('.code-copy'));
    dom.window.document.getElementById('assistant-close').click();

    dom.window.__gpuPreview.aiConfigured=true;
    dom.window.__gpuPreview.preferences['ai.model']='lab-model';
    dom.window.postMessage(dom.window.__gpuPreview,'*');await new Promise(resolve=>setTimeout(resolve,10));
    dom.window.document.getElementById('assistant-button').click();
    dom.window.document.getElementById('assistant-prompt').value='Inspect the task';
    dom.window.document.getElementById('assistant-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    dom.window.postMessage({type:'aiActivity',id:'model-0',phase:'waiting',state:'running',startedAt:Date.now()-12000,endpoint:'api.example.test'},'*');
    await new Promise(resolve=>setTimeout(resolve,10));
    const waiting=assistant.querySelector('.chat-activity .assistant-step[data-state=running]:last-child');
    assert.strictEqual(waiting.closest('.activity-group').open,true,'An active investigation must show its actual operations.');
    assert.ok(assistant.querySelector('.chat-entry.user .chat-role .icon'));
    assert.ok(waiting.closest('.chat-entry.assistant').querySelector('.chat-role .icon'));
    assert.ok(waiting.closest('.assistant-messages'),'Activity must be in the conversation, not below the sidebar fold.');
    assert.ok(waiting.textContent.includes('等待模型响应'));
    assert.ok(parseInt(waiting.querySelector('.step-duration').textContent)>=12,'Waiting must show elapsed time before any model text.');
    dom.window.postMessage({type:'aiStep',id:'task-call',name:'inspect_task',args:{server:'lab',pid:'42'},state:'running'},'*');
    await new Promise(resolve=>setTimeout(resolve,10));
    const tool=assistant.querySelector('.chat-activity .assistant-step:last-child');
    dom.window.postMessage({type:'aiStep',id:'task-call',name:'inspect_task',state:'done',result:'Task found'},'*');
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.strictEqual(assistant.querySelector('.chat-activity .assistant-step:last-child'),tool,'Tool completion must update its row rather than duplicate it.');
    assert.strictEqual(tool.dataset.state,'done');
    assert.ok(tool.textContent.includes('PID 42'));
    dom.window.postMessage({type:'aiApproval',id:'auth-1',operationId:'log-call',server:'lab',label:'Lab server',path:'/work/train.log',endpoint:'api.example.test',maxLines:500,maxBytes:262144},'*');
    await new Promise(resolve=>setTimeout(resolve,10));
    const permission=assistant.querySelector('.assistant-messages .ai-approval');
    assert.ok(permission.textContent.includes('/work/train.log'));
    assert.ok(permission.textContent.includes('api.example.test'));
    permission.querySelector('button').click();
    const choice=dom.window.__gpuMessages.findLast(m=>m.command==='resolveAiApproval');
    assert.strictEqual(choice.id,'auth-1');assert.strictEqual(choice.decision,'once');
    dom.window.postMessage({type:'aiApprovalResult',id:'auth-1',decision:'once'},'*');
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.strictEqual(permission.querySelectorAll('button').length,0,'Settled approval cards must not accept duplicate decisions.');
    const completedGroup=permission.closest('.activity-group');
    dom.window.postMessage({type:'aiResult',answer:'Progress evidence found.',html:'<p>Progress evidence found.</p>'},'*');
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.strictEqual(completedGroup.open,false,'A final successful answer must automatically collapse intermediate operations.');
    completedGroup.querySelector('summary').click();
    assert.strictEqual(completedGroup.open,true,'Completed operations must remain available for manual inspection.');
    dom.window.document.getElementById('assistant-prompt').value='Continue investigating';
    dom.window.document.getElementById('assistant-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    for(let i=0;i<110;i++)dom.window.postMessage({type:'aiStep',id:'many-'+i,name:'inspect_task',state:'done',result:'x'.repeat(100000)},'*');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(assistant.querySelectorAll('.assistant-step:not([data-state=running]):not([data-state=blocked])').length<=80,'Unlimited execution must not retain unlimited finished activity DOM.');
    assert.ok(assistant.querySelector('.activity-compacted'));
    assert.ok([...assistant.querySelectorAll('.assistant-step pre')].every(pre=>pre.textContent.length<17000),'Displayed results must be bounded excerpts.');
    dom.window.postMessage({type:'aiResult',error:'Connection reset (ECONNRESET)',canContinue:true},'*');
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.strictEqual(assistant.querySelectorAll('.assistant-step[data-state=running]').length,0,'Failure must finish pending indicators.');
    assert.ok(!assistant.textContent.includes('正在查询…'),'Failed replies must not leave a false querying placeholder.');
    assert.strictEqual([...assistant.querySelectorAll('.activity-group')].at(-1).open,true,'Errors and interrupted work must remain visible for diagnosis.');
    assistant.querySelector('.ai-continuation button').click();
    assert.strictEqual(dom.window.__gpuMessages.at(-1).command,'continueAi','Retry must resume saved work rather than send the same question again.');
    dom.window.postMessage({type:'aiReset'},'*');await new Promise(resolve=>setTimeout(resolve,10));
    assert.strictEqual(assistant.querySelector('.assistant-messages').childElementCount,0);
    dom.window.document.getElementById('assistant-close').click();

    dom.window.__gpuPreview.data.push({
        host: 'offline-node', gpus: [], collectedAt: Date.now(), latencyMs: 8000,
        stale: false, error: 'Server is unreachable.', errorCategory: 'unreachable'
    });
    dom.window.__gpuPreview.summary.serversTotal = 5;
    dom.window.postMessage(dom.window.__gpuPreview, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    const offlineSection = dom.window.document.querySelector('.offline-section');
    assert.ok(offlineSection);
    assert.strictEqual(offlineSection.open, false);
    assert.strictEqual(offlineSection.querySelectorAll('.server-band.offline').length, 1);
    assert.strictEqual(offlineSection.querySelector('.offline-count').textContent, '1');

    status.value = 'offline';
    status.dispatchEvent(new dom.window.Event('change'));
    assert.strictEqual(dom.window.document.querySelector('.offline-section').open, true);
    assert.strictEqual(dom.window.document.querySelectorAll('.server-band').length, 1);
    assert.deepStrictEqual(errors, []);
    console.log('Webview rendered, filtered, and inspected the research fleet without script errors.');
    dom.window.close();
}

void main();
