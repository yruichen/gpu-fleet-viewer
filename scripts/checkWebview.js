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
    assert.ok(dom.window.document.querySelectorAll('.user-chip').length >= 4);
    assert.strictEqual(dom.window.document.querySelectorAll('.summary-meter').length, 6);
    assert.ok(dom.window.document.querySelectorAll('.metric-meter').length > 20);
    assert.ok(dom.window.document.querySelectorAll('.health-meter').length >= 8);
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
    selectedBand.querySelector('.inspector-header button').click();
    assert.strictEqual(dom.window.document.querySelectorAll('.process-inspector').length, 0);

    const search = dom.window.document.getElementById('search-input');
    search.value = '4090';
    search.dispatchEvent(new dom.window.Event('input'));
    assert.strictEqual(dom.window.document.querySelectorAll('.server-band').length, 1);
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile').length, 2);
    search.value = '';
    search.dispatchEvent(new dom.window.Event('input'));

    const status = dom.window.document.getElementById('status-filter');
    status.value = 'available';
    status.dispatchEvent(new dom.window.Event('change'));
    assert.ok(dom.window.document.querySelectorAll('.gpu-tile.available').length > 0);
    assert.strictEqual(dom.window.document.querySelectorAll('.gpu-tile.busy').length, 0);

    status.value = 'all';
    status.dispatchEvent(new dom.window.Event('change'));
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
    console.log('Webview rendered, filtered, and inspected the research fleet without script errors.');
    dom.window.close();
}

void main();
