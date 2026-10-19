const assert=require('assert');
const http=require('http');
const cp=require('child_process');
const Module=require('module');
async function main(){
    const originalLoad=Module._load,originalExec=cp.execFile;
    const state=new Map(),messages=[],requests=[],ssh=[];
    let baseUrl,heldQuery;let holdQuery=false;const notices=[];
    const values={targets:['lab-node'],autoRefresh:false,'ai.protocol':'openai','ai.model':'lab-model'};
    const vscode={TreeItem:class{},env:{language:'en'},workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='ai.baseUrl'?baseUrl:(key in values?values[key]:fallback)})},window:{showInformationMessage:async message=>{notices.push(message);}}};
    Module._load=function(name,parent,main){return name==='vscode'?vscode:originalLoad.call(this,name,parent,main);};
    const {AiController}=require('../out/aiController');
    const {TaskService}=require('../out/taskService');
    const {GpuViewPanel}=require('../out/gpuView');
    void GpuViewPanel;
    Module._load=originalLoad;
    cp.execFile=function(command,args,options,callback){
        assert.strictEqual(command,'ssh');
        assert.ok(args.includes('lab-node'));
        assert.ok(args.includes('BatchMode=yes'));
        ssh.push(args);
        const remote=args.at(-1);
        const text=remote.includes('[\"log\",')?JSON.stringify({text:'2026-10-19T10:00:00Z step 100/1000\n2026-10-19T10:01:00Z step 200/1000\napi_key=synthetic-secret',modifiedAt:1,path:'/work/train.log'}):remote.startsWith('python3')?JSON.stringify({chain:[{pid:'42',ppid:'1',identity:'boot:42',user:'researcher',command:'python -c from multiprocessing.spawn import spawn_main; spawn_main() --multiprocessing-fork --api_key=synthetic-secret',cwd:'/work/experiment',elapsedSeconds:60,state:'R',logs:[]},{pid:'40',ppid:'1',identity:'boot:40',user:'researcher',command:'python train.py',cwd:'/work/experiment',elapsedSeconds:65,state:'R',logs:[]},{pid:'1',ppid:'0',identity:'boot:1',user:'root',command:'systemd',elapsedSeconds:100,state:'S',logs:[]}],children:[{pid:'99',ppid:'42',identity:'boot:99',user:'researcher',command:'data worker',elapsedSeconds:1,state:'R',logs:[]}],collectedAt:new Date().toISOString()}):'0, GPU-demo, Research GPU, 0, 0, 24576, 24576, 0, 30, 20, 200, 20\n__GPU_FLEET_PROCESSES__\nGPU-demo, 42, python, 10\n__GPU_FLEET_PROCESS_DETAILS__\n42 researcher 60 python train.py\n';
        if(holdQuery&&!remote.startsWith('python3'))heldQuery=()=>callback(null,text,'');else setImmediate(()=>callback(null,text,''));return {kill(){}};
    };
    const server=http.createServer((req,res)=>{
        let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
            const body=JSON.parse(raw);requests.push(body);
            if(body.model==='no-stream') {
                if(body.stream){res.statusCode=422;res.end('{}');}else{assert.ok(!body.tools);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Plain GPU chat works'}}]}));}
                return;
            }
            const n=requests.length;
            let name,args;
            if(n===1){name='get_fleet_status';args={};}
            else if(n===2){name='inspect_task';args={server:'host-'+require('crypto').createHash('sha256').update('lab-node').digest('hex').slice(0,16),pid:'42'};}
            else if(n===3){name='manage_reminders';args={action:'create',server:'host-'+require('crypto').createHash('sha256').update('lab-node').digest('hex').slice(0,16),mode:'taskEnded',pid:'42'};}
            res.setHeader('Content-Type','application/json');
            res.end(JSON.stringify({choices:[{message:name?{content:'',tool_calls:[{id:'call-'+n,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'**Task identified**\n\n`train.py` is running. Reminder saved.'}}]}));
        });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));baseUrl='http://127.0.0.1:'+server.address().port;
    const context={subscriptions:[],globalState:{get:(key,fallback)=>state.has(key)?state.get(key):fallback,update:async(key,value)=>state.set(key,JSON.parse(JSON.stringify(value)))},secrets:{get:async()=>'dummy-key'}};
    const controller=new AiController(context,{postMessage:async m=>messages.push(m)},()=>[],async()=>{});
    try{
        await controller.handle({command:'askAi',question:'What is running? Trace it and notify me when this task ends.'});
        assert.strictEqual(requests.length,4,'The real controller must complete the tool round trip.');
        assert.strictEqual(requests[1].messages.at(-1).role,'tool');
        assert.ok(requests[2].messages.at(-1).content.includes('train.py'));
        assert.ok(!requests[2].messages.at(-1).content.includes('synthetic-secret'),'Commands must be redacted after JSON parsing.');
        const reminders=state.get('gpu-fleet-viewer.reminders');
        assert.strictEqual(reminders.length,1);assert.strictEqual(reminders[0].identity,'boot:40');assert.strictEqual(reminders[0].pid,'40','A worker reminder must bind to its verified launcher.');
        assert.ok(messages.some(m=>m.type==='aiResult'&&m.html.includes('<strong>Task identified</strong>')));
        await assert.rejects(TaskService.get(context).query(TaskService.get(context).hosts()[0].id,'process',{pid:'1'}),/GPU task/,'System ancestors cannot become inspection capabilities.');
        await assert.rejects(TaskService.get(context).query(TaskService.get(context).hosts()[0].id,'process',{pid:'99'}),/GPU task/,'Children cannot become arbitrary inspection capabilities.');
        const count=ssh.length;
        controller.dispose();
        const tasks=TaskService.get(context);
        assert.strictEqual(tasks.state().reminders[0].status,'active','Closing chat must not cancel extension-owned reminders.');
        await tasks.manage({action:'cancel',id:reminders[0].id});
        assert.strictEqual(state.get('gpu-fleet-viewer.reminders')[0].status,'cancelled');
        assert.strictEqual(ssh.length,count,'Cancelling a reminder must not query SSH or invoke AI.');
        assert.ok(ssh.every(args=>!args.at(-1).includes('kill ')));
        const host=tasks.hosts()[0].id;
        const denied=await tasks.query(host,'log',{path:'/work/train.log'});
        assert.strictEqual(denied.needsAuthorization,true);
        assert.strictEqual(ssh.length,count,'An unauthorized log must never reach SSH.');
        await tasks.authorize(host,'/work/train.log',true);
        const log=await tasks.query(host,'log',{path:'/work/train.log'});
        assert.strictEqual(log.progress.remainingSeconds,480);
        assert.ok(!log.text.includes('synthetic-secret'));
        const future=await tasks.manage({action:'create',server:host,mode:'at',at:Date.now()+10000,expiresAt:Date.now()+20000});
        const beforeFuture=ssh.length;
        await tasks.tick();
        assert.strictEqual(ssh.length,beforeFuture,'Future timed checks must not poll before they are due.');
        const originalNow=Date.now;const simulated=Date.now()+15000;
        try{
            Date.now=()=>simulated;holdQuery=true;
            const ticking=tasks.tick();
            await new Promise(resolve=>setImmediate(resolve));
            assert.ok(heldQuery,'A due scheduled check must actually request the external snapshot.');
            await tasks.manage({action:'update',id:future.id,at:simulated+10000,expiresAt:simulated+20000});
            heldQuery();await ticking;
            assert.strictEqual(notices.length,0,'An in-flight old check must not notify after its schedule is edited.');
            assert.strictEqual(tasks.state().reminders.find(w=>w.id===future.id).status,'active');
        }finally{Date.now=originalNow;holdQuery=false;}
        await tasks.manage({action:'cancel',id:future.id});
        values['ai.model']='no-stream';
        const fallbackMessages=[];const fallback=new AiController(context,{postMessage:async m=>fallbackMessages.push(m)},()=>[],async()=>{});
        const before=requests.length;
        await fallback.handle({command:'askAi',question:'GPU advice'});
        assert.strictEqual(requests.length,before+2);
        assert.strictEqual(requests.at(-1).stream,false,'Compatibility retry must disable streaming as well as tools.');
        assert.ok(fallbackMessages.some(m=>m.type==='aiResult'&&m.answer==='Plain GPU chat works'));
        fallback.dispose();
        const secondContext={...context,subscriptions:[]};
        const restored=TaskService.get(secondContext);
        assert.ok(restored.state().logs.some(log=>log.path==='/work/train.log'&&log.authorized),'Saved log grants must remain visible and revocable after restart.');
        await restored.authorize(host,'/work/train.log',false);
        assert.ok(!restored.state().logs.some(log=>log.authorized));
        secondContext.subscriptions.forEach(d=>d.dispose());
        console.log('Assistant tool orchestration, actual monitor parsing, command redaction, persistent reminders and panel-independent lifetime passed.');
    }finally{
        controller.dispose();context.subscriptions.forEach(d=>d.dispose());
        cp.execFile=originalExec;Module._load=originalLoad;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
