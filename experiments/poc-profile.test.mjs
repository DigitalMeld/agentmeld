import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {updateProfile,agentProfile,profileContext} from '../apps/poc/profile.mjs';
import {createPocServer} from '../apps/poc/server.mjs';

test('profile validation, revisions and deleted-memory stale writes',()=>{
 const state={tasks:[]};assert.equal(agentProfile(state).name,'AgentMeld');
 const one=updateProfile(state,{revision:0,action:'remember',text:'Concise answers'});
 assert.match(profileContext(one),/Concise answers/);
 assert.throws(()=>updateProfile(state,{revision:0,action:'remember',text:'stale'}),e=>e.status===409);
 assert.throws(()=>updateProfile(state,{revision:1,action:'remember',text:'x',sourceTaskId:'unknown'}),e=>e.status===404);
 assert.throws(()=>updateProfile(state,{revision:1,action:'edit',name:'A',identity:'',persona:'',profile:'',grants:['all']}));
 updateProfile(state,{revision:1,action:'forget',id:one.memories[0].id});
 assert.doesNotMatch(profileContext(agentProfile(state)),/Concise answers/);
 assert.throws(()=>updateProfile(state,{revision:1,action:'remember',text:'stale resurrection'}),e=>e.status===409);
});

test('authenticated settings survive restart and changed preferences reset provider context but keep files',async t=>{
 const directory=await mkdtemp(tmpdir()+'/agent-profile-');let contexts=[];
 const execute=async(task,save,control,c)=>{contexts.push({text:control.agentContext,resumed:!!c.session,files:c.workspace.length});c.session={threadId:'fixture'};c.workspace=[{name:'a.txt',data:'YQ=='}];task.status='completed';};
 let app=await createPocServer({directory,port:0,execute});t.after(async()=>{await app.shutdown();await rm(directory,{recursive:true,force:true});});
 const call=async(path,data)=>{const r=await fetch(app.origin+'/api/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 const settle=async()=>{for(let i=0;i<100;i++){const s=(await call('state')).data;if(!s.active&&!s.tasks.some(t=>t.status==='queued'))return;await delay(10);}throw Error('Timeout');};
 const turn=async conversationId=>{const r=await call('tasks',{prompt:'test',files:[],requestKey:randomUUID(),conversationId});await settle();return r.data.conversationId;};
 assert.equal((await fetch(app.origin+'/api/agent')).status,401);
 const cid=await turn();await turn(cid);assert.equal(contexts[1].resumed,true);
 let r=await call('agent',{action:'remember',revision:0,text:'Prefer tables'});assert.equal(r.status,200);const memory=r.data.memories[0];
 await app.shutdown();app=await createPocServer({directory,port:0,execute});assert.equal((await call('agent')).data.memories[0].id,memory.id);
 await turn(cid);assert.equal(contexts[2].resumed,false);assert.equal(contexts[2].files,1);assert.match(contexts[2].text,/Prefer tables/);
 await call('agent',{action:'forget',revision:1,id:memory.id});await turn(cid);assert.equal(contexts[3].resumed,false);assert.doesNotMatch(contexts[3].text,/Prefer tables/);
 const race=await Promise.all([call('agent',{action:'remember',revision:2,text:'One'}),call('agent',{action:'remember',revision:2,text:'Two'})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
});

test('agent settings cannot change while a run is active',async t=>{
 const directory=await mkdtemp(tmpdir()+'/agent-profile-busy-');let release;const gate=new Promise(r=>release=r);
 const app=await createPocServer({directory,port:0,execute:async task=>{await gate;task.status='completed';}});
 t.after(async()=>{release();await app.shutdown();await rm(directory,{recursive:true,force:true});});
 const headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
 await fetch(app.origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify({prompt:'Wait',files:[],requestKey:randomUUID()})});
 const r=await fetch(app.origin+'/api/agent',{method:'POST',headers,body:JSON.stringify({revision:0,action:'remember',text:'Blocked'})});assert.equal(r.status,409);
 assert.equal((await(await fetch(app.origin+'/api/agent',{headers})).json()).revision,0);
});
