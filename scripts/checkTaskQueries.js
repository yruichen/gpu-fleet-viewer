const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { taskCommand, parseProgress, redactTaskText, taskReminderTarget } = require('../out/taskQueries');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-task-')));
try {
    const log = path.join(root, "train 'quoted'.log");
    fs.writeFileSync(log, 'old\n'.repeat(250) + '2026-10-19T10:00:00Z step 100/1000\n2026-10-19T10:01:00Z step 200/1000\napi_key=private-token\n');
    const result = JSON.parse(cp.execFileSync('sh', ['-c', taskCommand('log', { path: log })], { encoding: 'utf8' }));
    assert.ok(result.text.includes('step 200/1000'));
    assert.ok(!result.text.startsWith('old\n'.repeat(210)), 'Only a bounded log tail may be read.');
    const progress = parseProgress(result.text);
    assert.strictEqual(progress.current, 200);
    assert.strictEqual(progress.total, 1000);
    assert.strictEqual(progress.remainingSeconds, 480);
    assert.strictEqual(taskReminderTarget({chain:[{pid:'42',identity:'boot:42',user:'researcher',command:'python -c from multiprocessing.spawn import spawn_main --multiprocessing-fork'}],children:[]}),undefined,'An unresolved worker cannot stand in for the experiment.');
    assert.strictEqual(taskReminderTarget({chain:[{pid:'8',identity:'b:8',user:'r',command:'python train.py'},{pid:'7',identity:'b:7',user:'r',command:'python train.py'}],children:[]}).pid,'7','Forked processes can inherit the launcher command; watch their common root.');
    assert.strictEqual(parseProgress('GPU 99%, elapsed 3 hours'), undefined);
    assert.strictEqual(parseProgress('step 20/100\nstep 10/100').remainingSeconds, undefined, 'A reset/phase change cannot produce a guessed ETA.');
    assert.ok(!redactTaskText(result.text).includes('private-token'));
    assert.throws(() => taskCommand('process', { pid: '1; touch bad' }), /PID/);
    assert.throws(() => taskCommand('job', { job: '1;scancel 2' }), /job/i);
    assert.throws(() => taskCommand('shell', { command: 'kill 1' }), /query/i);
    const sensitive = path.join(root, '.env');
    fs.writeFileSync(sensitive, 'DO_NOT_READ=secret');
    assert.throws(() => taskCommand('log', { path: sensitive }), /sensitive/i);
    const link = path.join(root, 'linked.log');
    fs.symlinkSync(log, link);
    assert.throws(() => cp.execFileSync('sh', ['-c', taskCommand('log', { path: link })], { stdio: 'pipe' }), /failed/i);
    if (process.platform === 'linux') {
        const proc=JSON.parse(cp.execFileSync('sh',['-c',taskCommand('process',{pid:String(process.pid)})],{encoding:'utf8'}));
        assert.strictEqual(proc.chain[0].pid,String(process.pid));
        assert.ok(proc.chain[0].identity);
    } else assert.throws(()=>cp.execFileSync('sh',['-c',taskCommand('process',{pid:String(process.pid)})],{stdio:'pipe'}),/failed/i,'Unsupported process inspection must fail rather than report an ended task.');
    console.log('Task query boundaries, unsupported-host handling, bounded local log reads, secret redaction and evidence-based progress passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
