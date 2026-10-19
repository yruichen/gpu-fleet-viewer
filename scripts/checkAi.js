const assert = require('assert');
const http = require('http');
const { aiEndpoint, aiSecretKey, askAi, buildFleetContext } = require('../out/aiClient');
const { validatePreferenceChanges } = require('../out/preferences');

async function main() {
    assert.throws(() => validatePreferenceChanges({ refreshInterval: 0 }), /refreshInterval/);
    assert.throws(() => validatePreferenceChanges({ unexpected: 'value' }), /unexpected/);
    assert.throws(() => validatePreferenceChanges({ additionalHosts: ['-oProxyCommand=bad'] }), /additionalHosts/);
    assert.deepStrictEqual(validatePreferenceChanges({ refreshInterval: 10, showPower: false }), { refreshInterval: 10, showPower: false });

    assert.strictEqual(aiEndpoint('openai', 'https://example.com/v1/').pathname, '/v1/chat/completions');
    assert.strictEqual(aiEndpoint('anthropic', 'https://example.com').pathname, '/v1/messages');
    assert.strictEqual(aiEndpoint('anthropic', 'https://example.com/proxy/v1/messages').pathname, '/proxy/v1/messages');
    assert.throws(() => aiEndpoint('openai', 'https://user:password@example.com'), /URL/);
    assert.throws(() => aiEndpoint('other', 'https://example.com'), /protocol/i);
    assert.notStrictEqual(aiSecretKey('openai', 'https://one.example'), aiSecretKey('openai', 'https://two.example'));
    assert.strictEqual(aiSecretKey('openai', 'https://one.example'), aiSecretKey('openai', 'https://one.example/v1/chat/completions'));

    const fleet = [{ host: 'user@192.0.2.12', collectedAt: 1000, stale: true, error: 'private raw error', gpus: [{
        index: '0', uuid: 'GPU-test', name: 'Test GPU', utilization: { gpu: '10 %' },
        memory: { total: '24576 MiB', used: '1024 MiB', free: '23552 MiB' },
        temperature: { gpu: '45 C' }, power: { draw: '100 W', limit: '300 W' },
        availability: { available: false, reasons: ['1 compute process'] },
        processes: [{ user: 'alice', pid: '42', usedMemory: '1024 MiB', command: 'python private_experiment.py' }]
    }] }];
    const context = buildFleetContext(fleet, false);
    assert.ok(context.includes('GPU-test'));
    assert.ok(context.includes('stale'));
    assert.ok(!context.includes('192.0.2.12'));
    assert.ok(!context.includes('private raw error'));
    assert.ok(!context.includes('private_experiment'));
    assert.ok(buildFleetContext(fleet, true).includes('private_experiment'));

    const requests = [];
    const server = http.createServer((req, res) => {
        let text = '';
        req.on('data', chunk => text += chunk);
        req.on('end', () => {
            requests.push({ path: req.url, headers: req.headers, body: JSON.parse(text) });
            res.setHeader('Content-Type', 'application/json');
            if (req.url.includes('fail')) {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: { message: 'secret-dummy-must-not-leak' } }));
            } else if (req.url.includes('slow')) {
                // The client must cancel an actual in-flight request.
            } else if (req.url.includes('messages')) {
                res.end(JSON.stringify({ content: [{ type: 'text', text: 'Claude answer' }] }));
            } else {
                res.end(JSON.stringify({ choices: [{ message: { content: 'OpenAI answer' } }] }));
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const options = { protocol: 'openai', baseUrl, model: 'lab-model', apiKey: 'secret-dummy-must-not-leak', timeoutSeconds: 2 };
    try {
        assert.strictEqual(await askAi(options, [{ role: 'user', content: 'Which GPU?' }], context), 'OpenAI answer');
        assert.strictEqual(requests[0].path, '/v1/chat/completions');
        assert.strictEqual(requests[0].headers.authorization, 'Bearer secret-dummy-must-not-leak');
        assert.strictEqual(requests[0].body.messages.at(-1).content, 'Which GPU?');
        assert.ok(requests[0].body.messages[0].content.includes('GPU-test'));
        assert.strictEqual(await askAi({ ...options, protocol: 'anthropic' }, [{ role: 'user', content: 'Help' }], ''), 'Claude answer');
        assert.strictEqual(requests[1].headers['x-api-key'], 'secret-dummy-must-not-leak');
        assert.strictEqual(requests[1].headers['anthropic-version'], '2023-06-01');
        assert.strictEqual(requests[1].body.messages[0].role, 'user');
        assert.ok(typeof requests[1].body.system === 'string');
        await assert.rejects(askAi({ ...options, baseUrl: baseUrl + '/fail' }, [{ role: 'user', content: 'Help' }], ''), error => /401/.test(error.message) && !/secret-dummy/.test(error.message));
        const controller = new AbortController();
        const pending = askAi({ ...options, baseUrl: baseUrl + '/slow' }, [{ role: 'user', content: 'Help' }], '', controller.signal);
        setTimeout(() => controller.abort(), 20);
        await assert.rejects(pending, /cancel/i);
        await assert.rejects(askAi({ ...options, baseUrl: baseUrl + '/slow', timeoutSeconds: 0.05 }, [{ role: 'user', content: 'Help' }], ''), /timed out/i);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    console.log('Settings validation, AI context exclusions, wire protocols, authentication errors, cancellation, and timeout passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
