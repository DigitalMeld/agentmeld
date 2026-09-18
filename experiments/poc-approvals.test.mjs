import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {setTimeout as delay} from 'node:timers/promises';import {randomUUID} from 'node:crypto';
import {commandProposal,createApprovals} from '../apps/poc/approvals.mjs';import {createPocServer} from '../apps/poc/server.mjs';
const proposal={command:'printf hello',cwd:'/workspace',reason:'fixture',thread:'thread',turn:'turn',request:'request',item:'item'};
test('command approval binds native turn and declines expanded scope',()=>{
 const frame={id:1,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',itemId:'item',command:'printf hello',cwd:'/workspace'}},events=[{method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}}];
 assert.equal(commandProposal(frame,'thread',events).command,'printf hello');
 for(const delta of [{cwd:'/tmp'},{additionalPermissions:{}},{networkApprovalContext:{}},{kind:'stdin'},{threadId:'wrong'},{command:null},{availableDecisions:['acceptForSession']}])assert.throws(()=>commandProposal({...frame,params:{...frame.params,...delta}},'thread',events));
 assert.throws(()=>commandProposal(frame,'thread',[]));
});
async function fixture(t,ttl=120000){const directory=await mkdtemp(tmpdir()+'/approval-');const state={};let saved=0;const manager=createApprovals({state,save:async()=>{saved++;},directory,isActive:()=>true,ttl});t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});return {manager,state,saved:()=>saved};}
async function waiting(manager){for(let i=0;i<100;i++){const row=manager.list().find(r=>r.status==='pending');if(row)return row;await delay(10);}throw Error('No pending request');}
test('approval requires exact digest, resolves once, and concurrent callback is declined',async t=>{
 const {manager}=await fixture(t);const result=manager.request({id:'task',conversationId:'chat'},proposal);
 assert.equal(await manager.request({id:'task',conversationId:'chat'},{...proposal,request:'other'}),'decline');const row=await waiting(manager);
 await assert.rejects(manager.decide({id:row.id,digest:'wrong',allow:true}));
 const decisions=await Promise.allSettled([manager.decide({id:row.id,digest:row.digest,allow:true}),manager.decide({id:row.id,digest:row.digest,allow:true})]);assert.equal(decisions.filter(d=>d.status==='fulfilled').length,1);assert.equal(await result,'accept');assert.equal(manager.list()[0].status,'approved');
 assert.equal(await manager.request({id:'task',conversationId:'chat'},proposal),'decline');
});
test('expiry and shutdown never accept',async t=>{
 const {manager}=await fixture(t,50);const result=manager.request({id:'task',conversationId:'chat'},proposal);await waiting(manager);assert.equal(await result,'decline');assert.equal(manager.list()[0].status,'expired');
 const second=manager.request({id:'task',conversationId:'chat'},{...proposal,request:'second'});await waiting(manager);await manager.close();assert.equal(await second,'decline');assert.equal(manager.list()[1].status,'interrupted');
});
test('failed persistence cannot release approval and restart preserves interrupted review history',async t=>{
 const directory=await mkdtemp(tmpdir()+'/approval-failure-');const state={approvals:[{id:'old',status:'pending'}]};let fail=false;const manager=createApprovals({state,save:async()=>{if(fail)throw Error('disk');},directory,isActive:()=>true});t.after(async()=>{await manager.close();await rm(directory,{recursive:true,force:true});});await manager.recover();assert.equal(manager.list()[0].status,'interrupted');
 const result=manager.request({id:'task',conversationId:'chat'},proposal);const row=await waiting(manager);fail=true;await assert.rejects(manager.decide({id:row.id,digest:row.digest,allow:true}));assert.equal(await result,'decline');
});
test('owner API records denial and reloads approval history without dispatching on restart',async t=>{
 const directory=await mkdtemp(tmpdir()+'/approval-api-');let calls=0;const execute=async(task,save,control)=>{calls++;task.answer=await control.requestApproval(proposal);task.status='completed';};let app=await createPocServer({directory,port:0,execute});t.after(async()=>{await app.shutdown();await rm(directory,{recursive:true,force:true});});
 const api=async(path,data)=>{const r=await fetch(app.origin+'/api/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 assert.equal((await fetch(app.origin+'/api/approvals')).status,401);
 await api('tasks',{prompt:'fixture',files:[],requestKey:randomUUID()});let row;for(let i=0;i<100;i++){row=(await api('approvals')).data[0];if(row)break;await delay(10);}assert.ok(row);
 assert.equal((await api('approvals',{id:row.id,digest:row.digest,allow:false})).status,200);await app.shutdown();app=await createPocServer({directory,port:0,execute});assert.equal((await api('approvals')).data[0].status,'denied');assert.equal(calls,1);
});
