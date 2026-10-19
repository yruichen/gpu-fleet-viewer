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

    dom.window.document.getElementById('language-button').click();
    await new Promise(resolve => setTimeout(resolve, 10));
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
    assert.strictEqual(selectedBand.querySelectorAll('.process-inspector').length, 1);
    assert.strictEqual(selectedBand.querySelectorAll('.process-table tbody tr').length, 7);
    const focusedGpu = selectedBand.querySelectorAll('.gpu-main')[1];
    focusedGpu.focus();
    const processScroll = selectedBand.querySelector('.process-scroll');
    processScroll.scrollTop = 80;
    const processRow = selectedBand.querySelector('.process-table tbody tr');
    dom.window.__gpuPreview.data[2].gpus[1].processes[0].elapsedSeconds = 18500;
    dom.window.postMessage(dom.window.__gpuPreview, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(selectedBand.isConnected, 'Refreshing must retain the server section.');
    assert.strictEqual(dom.window.document.activeElement, focusedGpu, 'Refreshing must retain keyboard focus.');
    assert.strictEqual(selectedBand.querySelector('.process-scroll'), processScroll);
    assert.strictEqual(processScroll.scrollTop, 80, 'Refreshing must retain inspector scroll position.');
    assert.strictEqual(selectedBand.querySelector('.process-table tbody tr'), processRow);
    selectedBand.querySelector('.inspector-header button').click();
    assert.strictEqual(dom.window.document.querySelectorAll('.process-inspector').length, 0);

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
    dom.window.postMessage({ type: 'aiResult', answer: '<img src=x onerror=alert(1)>Plain answer' }, '*');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(assistant.querySelectorAll('.chat-text img').length, 0, 'Model output must stay plain text.');
    assert.ok(assistant.querySelector('.chat-text').textContent.includes('<img'));
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
