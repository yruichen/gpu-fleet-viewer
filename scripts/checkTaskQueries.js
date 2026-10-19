const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { taskCommand, redactTaskText, taskReminderTarget } = require('../out/taskQueries');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-task-')));
try {
    const log = path.join(root, "train 'quoted'.log");
    fs.writeFileSync(log, 'old\n'.repeat(250) + '2026-10-19T10:00:00Z step 100/1000\n2026-10-19T10:01:00Z step 200/1000\napi_key=private-token\n');
    const result = JSON.parse(cp.execFileSync('sh', ['-c', taskCommand('log', { path: log })], { encoding: 'utf8' }));
    assert.ok(result.text.includes('step 200/1000'));
    assert.ok(!result.text.startsWith('old\n'.repeat(210)), 'Only a bounded log tail may be read.');
    const largerLog=path.join(root,'large.log');
    fs.writeFileSync(largerLog,Array.from({length:600},(_,i)=>'line-'+i+' '+ 'x'.repeat(400)).join('\n'));
    const larger=JSON.parse(cp.execFileSync('sh',['-c',taskCommand('log',{path:largerLog,lines:500,maxBytes:256*1024})],{encoding:'utf8',maxBuffer:1024*1024}));
    assert.strictEqual(larger.text.split('\n').length,500,'Configured log reads must exceed the old 200-line/64KiB limits.');
    assert.ok(larger.text.startsWith('line-100 '));assert.ok(Buffer.byteLength(larger.text)>65536);
    const smaller=JSON.parse(cp.execFileSync('sh',['-c',taskCommand('log',{path:largerLog,lines:500,maxBytes:16384})],{encoding:'utf8'}));
    assert.ok(Buffer.byteLength(smaller.text)<=16384);assert.strictEqual(smaller.truncated,true);
    for(const limits of [{lines:0},{lines:1.5},{lines:10001},{maxBytes:2097153}])assert.throws(()=>taskCommand('log',{path:largerLog,...limits}),/log read limit/);
    assert.strictEqual(taskReminderTarget({chain:[{pid:'42',identity:'boot:42',user:'researcher',command:'python -c from multiprocessing.spawn import spawn_main --multiprocessing-fork'}],children:[]}),undefined,'An unresolved worker cannot stand in for the experiment.');
    assert.strictEqual(taskReminderTarget({chain:[{pid:'8',identity:'b:8',user:'r',command:'python train.py'},{pid:'7',identity:'b:7',user:'r',command:'python train.py'}],children:[]}).pid,'7','Forked processes can inherit the launcher command; watch their common root.');
    assert.ok(!redactTaskText(result.text).includes('private-token'));
    const redacted=redactTaskText("python train.py --api_key SECRET --password 'private spaced password' --access-token TOKEN");
    for(const value of ['SECRET','private spaced password','TOKEN'])assert.ok(!redacted.includes(value),'Task arguments must stay redacted, including quoted credentials.');
    const argumentsToCheck=['python','train.py','--password=top secret phrase','--api_key',"abc'def",'--access-token','two words','--output','runs/experiment'];
    const safeArguments=JSON.parse(cp.execFileSync('python3',['-c',
        "import ast,json,re,shlex,sys\nscript=shlex.split(sys.argv[1])[2]\nfunction=next(n for n in ast.parse(script).body if isinstance(n,ast.FunctionDef) and n.name=='public_argv')\nnamespace={'re':re}\nexec(compile(ast.Module(body=[function],type_ignores=[]),'<production task query>','exec'),namespace)\nprint(json.dumps(namespace['public_argv'](json.loads(sys.argv[2]))))",
        taskCommand('process',{pid:'42'}),JSON.stringify(argumentsToCheck)],{encoding:'utf8'}));
    assert.ok(!JSON.stringify(safeArguments).includes('top secret')&&!JSON.stringify(safeArguments).includes("abc'def")&&!JSON.stringify(safeArguments).includes('two words'));
    assert.strictEqual(safeArguments.at(-1),'runs/experiment','Non-sensitive task paths must remain available for model investigation.');
    assert.throws(() => taskCommand('process', { pid: '1; touch bad' }), /PID/);
    assert.throws(() => taskCommand('job', { job: '1;scancel 2' }), /job/i);
    assert.throws(() => taskCommand('shell', { command: 'kill 1' }), /query/i);
    const sensitive = path.join(root, '.env');
    fs.writeFileSync(sensitive, 'DO_NOT_READ=secret');
    assert.throws(() => taskCommand('log', { path: sensitive }), /sensitive/i);
    const link = path.join(root, 'linked.log');
    fs.symlinkSync(log, link);
    assert.throws(() => cp.execFileSync('sh', ['-c', taskCommand('log', { path: link })], { stdio: 'pipe' }), /failed/i);
    const output=path.join(root,'outputs');fs.mkdirSync(output);
    const stateFile=path.join(output,'arbitrary.progress');fs.writeFileSync(stateFile,'PRIVATE_CONTENT\n{"done":37,"target":80}\n');
    const listing=JSON.parse(cp.execFileSync('sh',['-c',taskCommand('files',{path:root})],{encoding:'utf8'}));
    assert.ok(listing.entries.some(e=>e.path===output&&e.kind==='directory'));
    assert.ok(!listing.entries.some(e=>e.path===sensitive||e.path===link),'Sensitive entries and symlinks must not become discovery capabilities.');
    const nested=JSON.parse(cp.execFileSync('sh',['-c',taskCommand('files',{path:output})],{encoding:'utf8'}));
    assert.ok(nested.entries.some(e=>e.path===stateFile&&e.kind==='file'));
    assert.ok(!JSON.stringify(nested).includes('PRIVATE_CONTENT'),'Directory discovery must not read file contents.');
    const head=JSON.parse(cp.execFileSync('sh',['-c',taskCommand('log',{path:stateFile,view:'head',lines:1,maxBytes:16384})],{encoding:'utf8'}));
    assert.strictEqual(head.text,'PRIVATE_CONTENT');
    assert.throws(()=>taskCommand('files',{path:root,offset:-1}),/offset/);
    assert.throws(()=>taskCommand('log',{path:stateFile,view:'execute'}),/view/);
    if (process.platform === 'linux') {
        const proc=JSON.parse(cp.execFileSync('sh',['-c',taskCommand('process',{pid:String(process.pid)})],{encoding:'utf8'}));
        assert.strictEqual(proc.chain[0].pid,String(process.pid));
        assert.ok(proc.chain[0].identity);
    } else assert.throws(()=>cp.execFileSync('sh',['-c',taskCommand('process',{pid:String(process.pid)})],{stdio:'pipe'}),/failed/i,'Unsupported process inspection must fail rather than report an ended task.');
    console.log('Task query boundaries, unsupported-host handling, bounded local log reads, secret redaction and raw task evidence passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
