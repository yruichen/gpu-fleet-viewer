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
            if(body.model==='compaction-check'){
                assert.ok(Buffer.byteLength(raw)<4*1024*1024,'Compacted history must fit the actual wire format.');
                const anthropic=req.url.endsWith('/messages');
                res.setHeader('Content-Type','application/json');res.end(JSON.stringify(anthropic?{content:[{type:'text',text:'Evidence retained'}]}:{choices:[{message:{content:'Evidence retained'}}]}));return;
            }
            if(body.model==='long-run'){
                const completed=body.messages.filter(m=>m.role==='tool').length;
                const message=completed>=65?{content:'Long investigation complete'}:{content:'',tool_calls:[{id:'long-'+completed,type:'function',function:{name:'get_fleet_status',arguments:'{}'}}]};
                res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));return;
            }
            if(body.model==='approval-model'){
                const hasResult=body.messages.some(m=>m.role==='tool');
                const message=hasResult?{content:'Log handled'}:{content:'',tool_calls:[{id:'log-approval',type:'function',function:{name:'read_task_log',arguments:JSON.stringify({server:'host-'+require('crypto').createHash('sha256').update('lab-node').digest('hex').slice(0,16),path:'/work/approval.log'})}}]};
                res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));return;
            }
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
        assert.ok(messages.some(m=>m.type==='aiActivity'&&m.phase==='waiting'),'Model waiting must be visible before any answer text.');
        assert.ok(messages.filter(m=>m.type==='aiStep'&&m.state==='running').every(m=>m.id),'Each tool operation needs a stable start/end identity.');
        assert.strictEqual(requests.length,4,'The real controller must complete the tool round trip.');
        assert.strictEqual(requests[1].messages.at(-1).role,'tool');
        assert.ok(requests[2].messages.at(-1).content.includes('train.py'));
        assert.ok(!requests[2].messages.at(-1).content.includes('synthetic-secret'),'Commands must be redacted after JSON parsing.');
        const reminders=state.get('gpu-fleet-viewer.reminders');
        assert.strictEqual(reminders.length,1);assert.strictEqual(reminders[0].identity,'boot:40');assert.strictEqual(reminders[0].pid,'40','A worker reminder must bind to its verified launcher.');
        assert.ok(messages.some(m=>m.type==='aiResult'&&m.html.includes('<strong>Task identified</strong>')));
        const evidence=[{role:'user',content:'Investigate the full lab workload'}];
        for(let i=0;i<5000;i++)evidence.push({role:'assistant',content:'',toolCalls:[{id:'evidence-'+i,name:'inspect_task',arguments:{server:'lab',pid:String(i)}}]},
            {role:'tool',toolCallId:'evidence-'+i,content:'task-'+i+' '+ 'x'.repeat(1024)});
        controller.compactEvidence(evidence);
        assert.ok(Buffer.byteLength(JSON.stringify(evidence))<1024*1024,'Many small results must compact as well as large logs.');
        assert.ok(evidence.some(m=>m.content==='Investigate the full lab workload'));
        assert.ok(evidence.at(-1).content.includes('task-4999'),'Recent evidence must survive compaction.');
        for(let i=0;i<evidence.length;i++)if(evidence[i].toolCalls)for(const call of evidence[i].toolCalls)assert.ok(evidence.slice(i+1).some(m=>m.role==='tool'&&m.toolCallId===call.id),'Compaction must retain complete protocol pairs.');
        const {aiTurn}=require('../out/aiClient');
        for(const protocol of ['openai','anthropic']){
            assert.strictEqual((await aiTurn({protocol,baseUrl,model:'compaction-check',apiKey:'dummy-key',timeoutSeconds:5,stream:false},evidence,'',[])).text,'Evidence retained');
        }
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
        values['ai.model']='long-run';
        const longMessages=[];const long=new AiController(context,{postMessage:async m=>longMessages.push(m)},()=>[],async()=>{});
        await long.handle({command:'askAi',question:'Investigate all tasks'});
        assert.ok(longMessages.some(m=>m.type==='aiResult'&&m.answer==='Long investigation complete'),'Default tool flow must pass 48 calls without a hard stop.');long.dispose();
        values['ai.maxToolCalls']=2;
        const checkpointMessages=[];const limited=new AiController(context,{postMessage:async m=>checkpointMessages.push(m)},()=>[],async()=>{});
        await limited.handle({command:'askAi',question:'Investigate tasks'});
        assert.ok(checkpointMessages.some(m=>m.type==='aiResult'&&m.paused&&m.canContinue));
        values['ai.maxToolCalls']=0;
        await limited.handle({command:'continueAi'});
        assert.ok(checkpointMessages.some(m=>m.type==='aiResult'&&m.answer==='Long investigation complete'),'Continuing must reuse completed tool results.');limited.dispose();
        values['ai.model']='approval-model';
        const approvalMessages=[];const withApproval=new AiController(context,{postMessage:async m=>approvalMessages.push(m)},()=>[],async()=>{});
        const pending=withApproval.handle({command:'askAi',question:'Read the task log'});
        for(let i=0;i<100&&!approvalMessages.some(m=>m.type==='aiApproval');i++)await new Promise(resolve=>setTimeout(resolve,5));
        const approval=approvalMessages.find(m=>m.type==='aiApproval');assert.ok(approval,'Approval must appear inline without a native confirmation.');
        const beforeGrant=ssh.length;
        await withApproval.handle({command:'resolveAiApproval',id:'wrong-id',decision:'once'});
        assert.strictEqual(ssh.length,beforeGrant,'Unmatched approvals cannot authorize a read.');
        await withApproval.handle({command:'resolveAiApproval',id:approval.id,decision:'once'});await pending;
        assert.ok(ssh.length>beforeGrant,'Allow must automatically resume the suspended tool.');
        assert.ok(!TaskService.get(context).state().logs.find(l=>l.path==='/work/approval.log')?.authorized,'Allow once must not persist a grant.');
        assert.ok(approvalMessages.some(m=>m.type==='aiResult'&&m.answer==='Log handled'));
        withApproval.dispose();
        for(const decision of ['deny','cancel','remember']){
            const events=[];const candidate=new AiController(context,{postMessage:async m=>events.push(m)},()=>[],async()=>{});
            const task=candidate.handle({command:'askAi',question:'Read this task log'});
            for(let i=0;i<100&&!events.some(m=>m.type==='aiApproval');i++)await new Promise(resolve=>setTimeout(resolve,5));
            const request=events.find(m=>m.type==='aiApproval');assert.ok(request);
            const queries=ssh.length;
            if(decision==='cancel'){
                await candidate.handle({command:'cancelAi'});await task;
                await candidate.handle({command:'resolveAiApproval',id:request.id,decision:'remember'});
            }else{await candidate.handle({command:'resolveAiApproval',id:request.id,decision});await task;}
            if(decision!=='remember')assert.strictEqual(ssh.length,queries,'Declining/cancelling must not read the log.');
            else assert.ok(TaskService.get(context).state().logs.find(l=>l.path==='/work/approval.log')?.authorized);
            if(decision==='cancel'){
                const resume=candidate.handle({command:'continueAi'});
                for(let i=0;i<100&&!events.some(m=>m.type==='aiApproval'&&m.id!==request.id);i++)await new Promise(resolve=>setTimeout(resolve,5));
                const renewed=events.find(m=>m.type==='aiApproval'&&m.id!==request.id);
                assert.ok(renewed,'Continue must retry the interrupted log operation with a fresh approval.');
                await candidate.handle({command:'resolveAiApproval',id:renewed.id,decision:'once'});await resume;
                assert.ok(ssh.length>queries,'Resuming the interrupted operation must actually query SSH.');
            }
            candidate.dispose();
        }

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
        assert.ok(!restored.state().logs.some(log=>log.path==='/work/train.log'&&log.authorized));
        secondContext.subscriptions.forEach(d=>d.dispose());
        console.log('Assistant tool orchestration, actual monitor parsing, command redaction, persistent reminders and panel-independent lifetime passed.');
    }finally{
        controller.dispose();context.subscriptions.forEach(d=>d.dispose());
        cp.execFile=originalExec;Module._load=originalLoad;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
