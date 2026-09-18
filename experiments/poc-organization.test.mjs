import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createPocServer } from '../apps/poc/server.mjs';
import { orderedChats,visibleOutputs,outputEntries,conversationExport } from '../apps/poc/public/organization.js';
import { updateConversation } from '../apps/poc/conversations.mjs';
const fixtureState=()=>({conversations:[{id:'a',title:'Alpha',createdAt:'2026-01-01'},{id:'b',title:'Beta',createdAt:'2026-01-02'}],tasks:[{id:'1',conversationId:'a',createdAt:'2026-01-01',status:'completed',prompt:'First',answer:'One',inputs:[{name:'input.csv',data:'PRIVATE'}],artifacts:[{name:'report.md',size:2,data:'PRIVATE'}],session:'PRIVATE'},{id:'2',conversationId:'b',createdAt:'2026-01-02',status:'failed',prompt:'Second',answer:'Two',inputs:[],artifacts:[{name:'values.csv',size:8}]},{id:'3',conversationId:'a',createdAt:'2026-01-03',status:'completed',prompt:'Third',answer:'Three',inputs:[],artifacts:[{name:'report.md',size:5}]}]});
test('organization orders pins/recent activity and filters archives without deleting turns',()=>{
 const state=fixtureState();assert.deepEqual(orderedChats(state,false).map(c=>c.id),['a','b']);
 updateConversation(state,{id:'b',pinned:true});assert.deepEqual(orderedChats(state,false).map(c=>c.id),['b','a']);
 updateConversation(state,{id:'b',archived:true});assert.equal(orderedChats(state,false).length,1);assert.equal(orderedChats(state,true,' BETA ')[0].id,'b');assert.equal(state.tasks.length,3);
 for(const data of [{id:'a',title:''},{id:'a',title:'x\ny'},{id:'a',title:'x'.repeat(121)},{id:'a',archived:'yes'},{id:'a',session:'bad'}])assert.throws(()=>updateConversation(state,data));
 state.tasks[0].status='running';assert.throws(()=>updateConversation(state,{id:'a',archived:true}),/finish/);
});
test('output filtering, sorting and version numbering stay scoped to conversation and exact filename',()=>{
 const state=fixtureState();assert.deepEqual(outputEntries(state).map(e=>e.version),[1,1,2]);
 assert.deepEqual(visibleOutputs(state,' ALPHA ','md').map(e=>e.task.id),['3','1']);
 assert.deepEqual(visibleOutputs(state,'','all','size').map(e=>e.file.size),[8,5,2]);
 assert.deepEqual(visibleOutputs(state,'','all','oldest').map(e=>e.task.id),['1','2','3']);
 assert.equal(visibleOutputs(state,'','json').length,0);
});
test('transcript exports include only selected conversation messages and filename metadata',()=>{
 const state=fixtureState();const json=conversationExport(state,'a','json');const data=JSON.parse(json);
 assert.equal(data.turns.length,2);assert.ok(!json.includes('PRIVATE'));assert.ok(!json.includes('Second'));assert.ok(!json.includes('session'));
 const md=conversationExport(state,'a','md');assert.match(md,/# Alpha/);assert.match(md,/input.csv/);assert.match(md,/Three/);assert.ok(!md.includes('PRIVATE'));assert.throws(()=>conversationExport(state,'a','html'));
});
test('authenticated metadata persists across restart; archived admissions fail and original files remain available',async()=>{
 const directory=await mkdtemp(tmpdir()+'/agentmeld-organize-');let app;
 const execute=async task=>{task.answer='Saved';task.status='completed';};
 const start=async()=>app=await createPocServer({directory,port:0,execute});
 const call=async(path,data)=>fetch(app.origin+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
 try{
 await start();
 assert.equal((await fetch(app.origin+'/api/conversations',{method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(app.origin+'/api/conversations',{method:'POST',headers:{Authorization:'Bearer '+app.token,Origin:'https://other.example'},body:'{}'})).status,403);
 const request={prompt:'Keep original',files:[{name:'original.txt',data:Buffer.from('original bytes').toString('base64')}],requestKey:randomUUID()};
 const task=await(await call('/api/tasks',request)).json();
 for(let i=0;i<100;i++){const s=await(await call('/api/state')).json();if(!s.active)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal((await call('/api/conversations',{id:task.conversationId,title:'Renamed',pinned:true,archived:true})).status,200);
 assert.equal((await call('/api/tasks',{...request,conversationId:task.conversationId,requestKey:randomUUID()})).status,409);
 assert.equal((await call('/api/file?kind=input&task='+task.id+'&name=original.txt')).status,200);
 assert.equal(await(await call('/api/file?kind=input&task='+task.id+'&name=original.txt')).text(),'original bytes');
 assert.equal((await call('/api/file?kind=workspace&task='+task.id+'&name=original.txt')).status,400);
 assert.equal((await call('/api/file?kind=input&task='+task.id+'&name=missing')).status,404);
 await app.shutdown();await start();const s=await(await call('/api/state')).json();assert.equal(s.conversations[0].title,'Renamed');assert.equal(s.conversations[0].archived,true);assert.equal(s.conversations[0].pinned,true);assert.equal(s.tasks.length,1);
 assert.equal((await call('/api/conversations',{id:task.conversationId,archived:false})).status,200);
 assert.equal((await call('/api/tasks',{prompt:'Continue',files:[],conversationId:task.conversationId,requestKey:randomUUID()})).status,202);
 }finally{if(app)await app.shutdown();await rm(directory,{recursive:true,force:true});}
});
test('archive endpoint rejects active cleanup even when the executor has set completed',async()=>{
 const directory=await mkdtemp(tmpdir()+'/agentmeld-archive-');let release;const gate=new Promise(r=>release=r);
 const app=await createPocServer({directory,port:0,execute:async task=>{task.status='completed';await gate;}});
 const headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
 try{
 const task=await(await fetch(app.origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify({prompt:'Cleanup pending',files:[],requestKey:randomUUID()})})).json();
 const response=await fetch(app.origin+'/api/conversations',{method:'POST',headers,body:JSON.stringify({id:task.conversationId,archived:true})});assert.equal(response.status,409);
 }finally{release();await app.shutdown();await rm(directory,{recursive:true,force:true});}
});
