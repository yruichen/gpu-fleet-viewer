const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-release-'));
const script = path.join(__dirname, 'resolveRelease.sh');
const output = path.join(directory, 'outputs');
const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' });
function run(ref = 'refs/heads/main', name = 'main') {
    fs.writeFileSync(output, '');
    const result = spawnSync('bash', [script], { cwd: directory, env: { ...process.env, GITHUB_REF: ref, GITHUB_REF_NAME: name, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    return { status: result.status, values: Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('='))) };
}
try {
    git('init', '-q');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'First');
    fs.writeFileSync(path.join(directory, 'package.json'), '{"version":"1.3.0"}');
    assert.strictEqual(run().values.publish, 'true', 'A new main version should publish.');
    git('tag', 'v1.3.0');
    assert.strictEqual(run('refs/tags/v1.3.0', 'v1.3.0').values.publish, 'true', 'A failed release must be retryable from the same tag.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'Later');
    assert.strictEqual(run().values.publish, 'false', 'An unchanged version on a later main commit must not republish.');
    assert.notStrictEqual(run('refs/tags/v1.2.0', 'v1.2.0').status, 0, 'Mismatched tags must fail.');
    assert.notStrictEqual(run('refs/heads/feature', 'feature').status, 0, 'Manual release from an arbitrary branch must fail.');
    console.log('Release decisions passed for new, unchanged, retried, mismatched, and non-main versions.');
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
