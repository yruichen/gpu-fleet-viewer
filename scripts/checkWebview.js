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
    assert.match(dom.window.document.getElementById('refresh-state').textContent, /^Updated /);

    dom.window.document.querySelectorAll('.server-band')[2].querySelectorAll('.gpu-tile')[1].click();
    const selectedBand = dom.window.document.querySelectorAll('.server-band')[2];
    assert.strictEqual(selectedBand.querySelectorAll('.process-inspector').length, 1);
    assert.strictEqual(selectedBand.querySelectorAll('.process-table tbody tr').length, 7);
    selectedBand.querySelector('.inspector-close').click();
    assert.strictEqual(dom.window.document.querySelectorAll('.process-inspector').length, 0);
    console.log('Webview rendered the fleet matrix and interactive process inspector without script errors.');
    dom.window.close();
}

void main();
