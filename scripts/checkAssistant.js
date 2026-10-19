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
        if(remote.includes('["files",')){
            const nested=remote.includes('/work/experiment/arbitrary-run');
            setImmediate(()=>callback(null,JSON.stringify({path:nested?'/work/experiment/arbitrary-run':'/work/experiment',entries:[nested?{path:'/work/experiment/arbitrary-run/state.metrics',kind:'file',size:123,modifiedAt:1}:{path:'/work/experiment/arbitrary-run',kind:'directory',size:0,modifiedAt:1}],nextOffset:null,contentsRead:false}),''));return {kill(){}};
        }
        if(remote.includes('["log",')&&remote.includes('state.metrics')){
            setImmediate(()=>callback(null,JSON.stringify({path:'/work/experiment/arbitrary-run/state.metrics',text:'{"completed_batches":37,"planned_batches":80,"mean_seconds_per_batch":2.5}',modifiedAt:1}),''));return {kill(){}};
        }
        const text=remote.includes('[\"log\",')?JSON.stringify({text:'2026-10-19T10:00:00Z step 100/1000\n2026-10-19T10:01:00Z step 200/1000\napi_key=synthetic-secret',modifiedAt:1,path:'/work/train.log'}):remote.startsWith('python3')?JSON.stringify({chain:[{pid:'42',ppid:'1',identity:'boot:42',user:'researcher',command:'python -c from multiprocessing.spawn import spawn_main; spawn_main() --multiprocessing-fork --api_key=synthetic-secret',cwd:'/work/experiment',elapsedSeconds:60,state:'R',logs:['/work/approval.log','/work/full.log']},{pid:'40',ppid:'1',identity:'boot:40',user:'researcher',command:'python train.py',cwd:'/work/experiment',elapsedSeconds:65,state:'R',logs:[]},{pid:'1',ppid:'0',identity:'boot:1',user:'root',command:'systemd',elapsedSeconds:100,state:'S',logs:[]}],children:[{pid:'99',ppid:'42',identity:'boot:99',user:'researcher',command:'data worker',elapsedSeconds:1,state:'R',logs:[]}],collectedAt:new Date().toISOString()}):'0, GPU-demo, Research GPU, 0, 0, 24576, 24576, 0, 30, 20, 200, 20\n__GPU_FLEET_PROCESSES__\nGPU-demo, 42, python, 10\n__GPU_FLEET_PROCESS_DETAILS__\n42 researcher 60 python train.py\n';
        if(holdQuery&&!remote.startsWith('python3'))heldQuery=()=>callback(null,text,'');else setImmediate(()=>callback(null,text,''));return {kill(){}};
    };
    const server=http.createServer((req,res)=>{
        let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
            const body=JSON.parse(raw);requests.push(body);
            if(body.model==='discovery-model'){
                const results=body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
                let call;
                if(!results.length)call={name:'inspect_task',arguments:{server:require('../out/taskService').serverId('lab-node'),pid:'42'}};
                else if(results.at(-1).chain)call={name:'list_task_files',arguments:{server:require('../out/taskService').serverId('lab-node'),path:results.at(-1).browsableDirectories[0]}};
                else if(results.at(-1).entries){const entry=results.at(-1).entries[0];call={name:entry.kind==='directory'?'list_task_files':'read_task_log',arguments:{server:require('../out/taskService').serverId('lab-node'),path:entry.path}};}
                const message=call?{content:'Investigating evidence before answering.',tool_calls:[{id:'discovery-'+results.length,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}]}:{content:results.at(-1).text};
                res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));return;
            }
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
            if(body.model==='no-stream'||body.model==='no-stream-tools') {
                if(body.stream||(body.model==='no-stream'&&body.tools)){res.statusCode=422;res.end('{}');}else{assert.strictEqual(Boolean(body.tools),body.model==='no-stream-tools');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Plain GPU chat works'}}]}));}
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
    const context={subscriptions:[],globalState:{keys:()=>[...state.keys()],get:(key,fallback)=>state.has(key)?state.get(key):fallback,update:async(key,value)=>state.set(key,JSON.parse(JSON.stringify(value)))},secrets:{get:async()=>'dummy-key'}};
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
        await assert.rejects(tasks.query(host,'log',{path:'/work/train.log'},undefined,true),/Invalid file permission/);
        const log=await tasks.query(host,'log',{path:'/work/train.log'},undefined,'once');
        assert.ok(log.text.includes('step 200/1000'));
        assert.ok(!Object.hasOwn(log,'progress'),'Progress semantics must be interpreted from raw evidence by the model.');
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
        const beforeUnknown=ssh.length;
        await assert.rejects(tasks.query(host,'files',{path:'/unrelated/directory'}),/not been discovered/);
        assert.strictEqual(ssh.length,beforeUnknown,'Unknown directories cannot be scanned through model-supplied paths.');
        values['ai.model']='discovery-model';
        const discovered=[];const discovery=new AiController(context,{postMessage:async m=>discovered.push(m)},()=>[],async()=>{});
        const investigation=discovery.handle({command:'askAi',question:'Check progress using whatever evidence the task actually produces'});
        for(let i=0;i<100&&!discovered.some(m=>m.type==='aiApproval');i++)await new Promise(resolve=>setTimeout(resolve,5));
        const discoveredApproval=discovered.find(m=>m.type==='aiApproval');
        assert.strictEqual(discoveredApproval?.path,'/work/experiment/arbitrary-run/state.metrics','Directory exploration must compose to a real observed file, without filename templates.');
        await discovery.handle({command:'resolveAiApproval',id:discoveredApproval.id,decision:'once'});await investigation;
        assert.ok(discovered.some(m=>m.type==='aiResult'&&m.answer?.includes('completed_batches')),'Raw non-step/epoch evidence must reach the model after authorization.');discovery.dispose();
        assert.ok(!discovered.find(m=>m.type==='aiResult'&&m.answer)?.answer.includes('Investigating evidence'),'Final answers must not retain intermediate model commentary outside the collapsed operations.');
        assert.ok(discovered.some(m=>m.type==='aiActivity'&&m.text?.includes('Investigating evidence')),'Intermediate commentary must remain available in the operation records.');
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
        assert.strictEqual((await tasks.query(host,'log',{path:'/work/approval.log'})).needsAuthorization,true,'Allow once must not authorize later reads.');
        assert.ok(approvalMessages.some(m=>m.type==='aiResult'&&m.answer==='Log handled'));
        withApproval.dispose();
        for(const decision of ['deny','cancel','full']){
            const events=[];const candidate=new AiController(context,{postMessage:async m=>events.push(m)},()=>[],async()=>{});
            const task=candidate.handle({command:'askAi',question:'Read this task log'});
            for(let i=0;i<100&&!events.some(m=>m.type==='aiApproval');i++)await new Promise(resolve=>setTimeout(resolve,5));
            const request=events.find(m=>m.type==='aiApproval');assert.ok(request);
            const queries=ssh.length;
            if(decision==='cancel'){
                await candidate.handle({command:'cancelAi'});await task;
                await candidate.handle({command:'resolveAiApproval',id:request.id,decision:'once'});
            }else if(decision==='full'){
                await candidate.handle({command:'setAiPermissionMode',sessionId:events.findLast(m=>m.type==='aiState').activeId,mode:'full'});await task;
            }else{await candidate.handle({command:'resolveAiApproval',id:request.id,decision});await task;}
            if(decision!=='full')assert.strictEqual(ssh.length,queries,'Declining/cancelling must not read the log.');
            else {
                const beforeFullRead=ssh.length,approvals=events.filter(m=>m.type==='aiApproval').length;
                await candidate.execute('read_task_log',{server:host,path:'/work/full.log'},new AbortController().signal);
                assert.strictEqual(ssh.length,beforeFullRead+1,'Full Access must execute subsequent safe reads without another approval.');
                assert.strictEqual(events.filter(m=>m.type==='aiApproval').length,approvals);
                await assert.rejects(candidate.execute('read_task_log',{server:host,path:'/work/.env'},new AbortController().signal),/sensitive/i);
                await assert.rejects(candidate.execute('read_task_log',{server:host,path:'/unobserved/file.log'},new AbortController().signal),/not been observed/);
                await assert.rejects(candidate.execute('run_shell',{command:'kill 42'},new AbortController().signal),/not allowed/);
                await candidate.handle({command:'setAiPermissionMode',sessionId:events.findLast(m=>m.type==='aiState').activeId,mode:'confirm'});
                assert.strictEqual((await tasks.query(host,'log',{path:'/work/full.log'})).needsAuthorization,true);
            }
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


        const raceEvents=[];const race=new AiController(context,{postMessage:async m=>raceEvents.push(m)},()=>[],async()=>{});
        const raceTurn=race.handle({command:'askAi',question:'Read the task log'});
        for(let i=0;i<100&&!raceEvents.some(m=>m.type==='aiApproval');i++)await new Promise(resolve=>setTimeout(resolve,5));
        assert.ok(raceEvents.some(m=>m.type==='aiApproval'));
        values.maxConcurrentHosts=1;
        let releaseSlot;const blocker=tasks.runQuery(()=>new Promise(resolve=>{releaseSlot=resolve;}));
        const beforeQueuedRead=ssh.length;
        const raceId=raceEvents.findLast(m=>m.type==='aiState').activeId;
        await race.handle({command:'setAiPermissionMode',sessionId:raceId,mode:'full'});
        await new Promise(resolve=>setImmediate(resolve));
        assert.strictEqual(tasks.queryWaiters.length,1,'Automatic read must be queued behind the shared SSH budget.');
        await race.handle({command:'setAiPermissionMode',sessionId:raceId,mode:'confirm'});
        await raceTurn;releaseSlot();await blocker;delete values.maxConcurrentHosts;
        assert.strictEqual(ssh.length,beforeQueuedRead,'Downgrading must cancel an automatic read released by switching a pending approval to Full Access.');
        race.dispose();

        const switchingEvents=[];const switching=new AiController(context,{postMessage:async m=>switchingEvents.push(m)},()=>[],async()=>{});
        const oldTurn=switching.handle({command:'askAi',question:'Inspect the original task'});
        for(let i=0;i<100&&!switchingEvents.some(m=>m.type==='aiApproval');i++)await new Promise(resolve=>setTimeout(resolve,5));
        const oldApproval=switchingEvents.find(m=>m.type==='aiApproval');assert.ok(oldApproval);
        const oldId=switchingEvents.findLast(m=>m.type==='aiState').activeId;
        const beforeSwitch=ssh.length;
        await switching.handle({command:'newAiSession'});await oldTurn;
        const newId=switchingEvents.findLast(m=>m.type==='aiSession').id;assert.notStrictEqual(newId,oldId);
        await switching.handle({command:'resolveAiApproval',id:oldApproval.id,decision:'once'});
        await switching.handle({command:'setAiPermissionMode',sessionId:oldId,mode:'full'});
        assert.strictEqual(switchingEvents.findLast(m=>m.type==='aiState').permissionMode,'confirm','Stale permission events cannot grant access to another chat.');
        assert.strictEqual(ssh.length,beforeSwitch,'Switching chats must cancel pending reads and invalidate approval tokens.');
        assert.deepStrictEqual(switchingEvents.findLast(m=>m.type==='aiSession').messages,[]);
        await switching.handle({command:'switchAiSession',id:oldId});
        assert.ok(switchingEvents.findLast(m=>m.type==='aiSession').canContinue,'Interrupted investigation must stay attached to its original chat.');switching.dispose();

        values['ai.model']='no-stream';
        const fallbackMessages=[];const fallback=new AiController(context,{postMessage:async m=>fallbackMessages.push(m)},()=>[],async()=>{});
        const before=requests.length;
        await fallback.handle({command:'askAi',question:'GPU advice'});
        assert.strictEqual(requests.length,before+3);
        assert.strictEqual(requests.at(-1).stream,false,'Compatibility retry must disable streaming as well as tools.');
        assert.ok(fallbackMessages.some(m=>m.type==='aiResult'&&m.answer==='Plain GPU chat works'));
        assert.ok(fallbackMessages.some(m=>m.type==='aiCapability'&&m.toolsAvailable===false),'Loss of investigation capability must be explicit.');
        fallback.dispose();
        values['ai.model']='no-stream-tools';
        const nonstreamMessages=[];const nonstream=new AiController(context,{postMessage:async m=>nonstreamMessages.push(m)},()=>[],async()=>{});
        const beforeNonstream=requests.length;await nonstream.handle({command:'askAi',question:'GPU task question'});
        assert.strictEqual(requests.length,beforeNonstream+2);
        assert.ok(requests.at(-1).tools,'Turning off streaming must preserve tools before considering basic-chat fallback.');
        assert.ok(!nonstreamMessages.some(m=>m.type==='aiCapability'));nonstream.dispose();
        values['ai.saveChatHistory']=true;
        const sessionEvents=[];const chats=new AiController(context,{postMessage:async m=>sessionEvents.push(m)},()=>[],async()=>{});
        await chats.handle({command:'askAi',question:'Remember the first task'});
        const first=sessionEvents.findLast(m=>m.type==='aiState').activeId;
        await chats.handle({command:'setAiPermissionMode',sessionId:first,mode:'full'});
        await chats.handle({command:'newAiSession',draft:'unfinished task question'});
        const second=sessionEvents.findLast(m=>m.type==='aiSession');
        assert.notStrictEqual(second.id,first);assert.strictEqual(second.permissionMode,'confirm');
        await chats.handle({command:'askAi',question:'A separate investigation'});
        assert.ok(!JSON.stringify(requests.at(-1).messages).includes('Remember the first task'),'New chats must not share model history.');
        await chats.handle({command:'switchAiSession',id:first,draft:'second draft'});
        const returned=sessionEvents.findLast(m=>m.type==='aiSession');
        assert.strictEqual(returned.draft,'unfinished task question');assert.strictEqual(returned.permissionMode,'full');
        assert.ok(returned.messages.some(m=>m.content==='Remember the first task'));
        await chats.handle({command:'renameAiSession',id:first,title:'Training progress'});
        assert.strictEqual(sessionEvents.findLast(m=>m.type==='aiState').sessions.find(s=>s.id===first).title,'Training progress');
        await chats.handle({command:'deleteAiSession',id:second.id});
        assert.ok(!sessionEvents.findLast(m=>m.type==='aiState').sessions.some(s=>s.id===second.id));
        chats.dispose();await chats.storageWrite;
        const saved=state.get(chats.storageKey());assert.ok(saved.some(s=>s.id===first));
        const {restoreChatSessions}=require('../out/chatSessions');
        assert.deepStrictEqual(restoreChatSessions({}),[]);
        assert.strictEqual(restoreChatSessions([...saved,...saved,{id:'invalid id'}]).length,saved.length,'Malformed or duplicate stored sessions must be ignored.');
        assert.ok(saved.every(s=>!('permissionMode'in s)&&!('history'in s)&&!('continuation'in s)),'Local storage must exclude Full Access, tool evidence and pending work.');
        const restoredEvents=[];const restored=new AiController(context,{postMessage:async m=>restoredEvents.push(m)},()=>[],async()=>{});
        await restored.handle({command:'aiState',load:true});
        assert.strictEqual(restoredEvents.findLast(m=>m.type==='aiSession').permissionMode,'confirm');
        assert.ok(restoredEvents.findLast(m=>m.type==='aiSession').messages.some(m=>m.content==='Remember the first task'));
        values['ai.model']='other-provider-model';restored.reset();await restored.handle({command:'aiState',load:true});
        assert.strictEqual(restoredEvents.findLast(m=>m.type==='aiSession').messages.length,0,'Changing model/provider must not replay another provider conversation.');
        state.set('gpu-fleet-viewer.chatSessions.closed-panel',[{messages:[{role:'user',content:'closed panel text'}]}]);
        values['ai.saveChatHistory']=false;restored.historySettingsChanged();await restored.storageWrite;
        assert.deepStrictEqual(state.get(restored.storageKey()),[]);assert.deepStrictEqual(state.get('gpu-fleet-viewer.chatSessions.closed-panel'),[],'Disabling history must clear closed-panel copies too.');restored.dispose();await restored.storageWrite;
        console.log('Assistant tool orchestration, actual monitor parsing, command redaction, persistent reminders and panel-independent lifetime passed.');
    }finally{
        controller.dispose();context.subscriptions.forEach(d=>d.dispose());
        cp.execFile=originalExec;Module._load=originalLoad;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
