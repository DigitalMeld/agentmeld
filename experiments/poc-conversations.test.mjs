import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPocServer } from '../apps/poc/server.mjs';
import { admit, openStore } from '../apps/poc/conversations.mjs';
const request=(prompt,conversationId=null)=>({prompt,conversationId,files:[],requestKey:randomUUID()});
async function fixture(t,execute){
 const directory=await mkdtemp(tmpdir()+'/agentmeld-chat-');
 let app=await createPocServer({directory,port:0,execute});
 t.after(async()=>{await app.shutdown();await rm(directory,{recursive:true,force:true});});
 const call=async(path,body)=>{
  const response=await fetch(app.origin+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json()};
 };
 return {call,directory,restart:async()=>{await app.shutdown();app=await createPocServer({directory,port:0,execute});}};
}
async function settled(call){for(let i=0;i<100;i++){const s=(await call('state')).data;if(!s.active&&!s.tasks.some(t=>t.status==='queued'))return s;await delay(10);}throw Error('Did not settle');}
test('follow-ups serialize, preserve conversation/workspace/session across restart, and new chat is clean',async t=>{
 let concurrent=0,peak=0;
 const f=await fixture(t,async(task,changed,control,c)=>{
  peak=Math.max(peak,++concurrent);await delay(15);
  if(c.session){assert.equal(c.workspace[0].data,'cmVwb3J0');task.answer='Resumed '+c.session.threadId;}
  else {assert.deepEqual(c.workspace,[]);c.session={threadId:randomUUID()};task.answer='Fresh';}
  c.workspace=[{name:'report.md',data:'cmVwb3J0'}];
  task.artifacts=[...c.workspace];task.status='completed';task.activity='Finished';--concurrent;await changed();
 });
 const first=await f.call('tasks',request('First'));assert.equal(first.status,202);const cid=first.data.conversationId;
 const [two,three]=await Promise.all([f.call('tasks',request('Second',cid)),f.call('tasks',request('Third',cid))]);
 assert.equal(two.status,202);assert.equal(three.status,202);
 let s=await settled(f.call);assert.equal(peak,1);assert.equal(s.conversations.length,1);assert.equal(s.tasks.length,3);assert.match(s.tasks[2].answer,/Resumed/);
 assert.ok(!JSON.stringify(s).includes('threadId'));assert.ok(!JSON.stringify(s).includes('cmVwb3J0'));
 await f.restart();await f.call('tasks',request('Fourth',cid));s=await settled(f.call);assert.match(s.tasks[3].answer,/Resumed/);
 await f.call('tasks',request('New'));s=await settled(f.call);assert.equal(s.tasks[4].answer,'Fresh');assert.equal(s.conversations.length,2);
});
test('duplicate admission and conflicting reuse, unknown conversation, malformed files',async t=>{
 const f=await fixture(t,async task=>{task.status='completed';});
 const data=request('Once');const [a,b]=await Promise.all([f.call('tasks',data),f.call('tasks',data)]);
 assert.equal(a.data.id,b.data.id);assert.equal((await settled(f.call)).tasks.length,1);
 assert.equal((await f.call('tasks',{...data,prompt:'Other'})).status,409);
 assert.equal((await f.call('tasks',request('No',randomUUID()))).status,404);
 assert.equal((await f.call('tasks',{...request('Bad'),files:[{name:'x',data:'a'}]})).status,400);
});
test('legacy bytes preserved, no native session invented; interrupted runs block continuation',async t=>{
 const directory=await mkdtemp(tmpdir()+'/agentmeld-migrate-');t.after(()=>rm(directory,{recursive:true,force:true}));
 const legacy=JSON.stringify({tasks:[{id:randomUUID(),prompt:'Old',answer:'Saved',inputs:[{name:'x.txt',data:'eA=='}],artifacts:[],status:'completed',createdAt:new Date().toISOString()}]});
 await writeFile(directory+'/state.json',legacy);const store=await openStore(directory);
 const backups=(await readdir(directory)).filter(n=>n.startsWith('state-v1-backup-'));assert.equal(backups.length,1);assert.equal(await readFile(directory+'/'+backups[0],'utf8'),legacy);
 assert.equal(store.state.conversations[0].session,null);
 assert.throws(()=>admit(store.state,request('Continue',store.state.conversations[0].id)),/cannot safely resume/);
 const {task}=admit(store.state,request('Fresh'));task.status='running';await store.save();
 const reopened=await openStore(directory);assert.equal(reopened.state.tasks[1].status,'interrupted');
 assert.throws(()=>admit(reopened.state,request('Continue',task.conversationId)),/cannot safely resume/);
 assert.equal((await readdir(directory)).filter(n=>n.startsWith('state-v1-backup-')).length,1);
});
test('stop targets a queued turn without cancelling the active turn',async t=>{
 let release;const gate=new Promise(r=>release=r);t.after(()=>release());
 const f=await fixture(t,async task=>{await gate;task.status='completed';});
 const first=await f.call('tasks',request('Working'));const next=await f.call('tasks',request('Queued',first.data.conversationId));
 assert.equal((await f.call('stop',{taskId:randomUUID()})).status,404);
 assert.equal((await f.call('stop',{taskId:next.data.id})).status,200);
 let s=(await f.call('state')).data;assert.equal(s.tasks[0].status,'running');assert.equal(s.tasks[1].status,'cancelled');assert.deepEqual(s.tasks[1].events.map(e=>e.kind),['queued','cancelled']);
 release();await settled(f.call);
});
test('store API and files preserve local authentication and omit private continuation',async t=>{
 const directory=await mkdtemp(tmpdir()+'/agentmeld-auth-');
 const app=await createPocServer({directory,port:0,execute:async(task,changed,control,c)=>{c.session={threadId:'private-reference'};task.artifacts=[{name:'result.txt',data:'c2F2ZWQ='}];task.status='completed';}});
 t.after(async()=>{await app.shutdown();await rm(directory,{recursive:true,force:true});});
 assert.equal((await fetch(app.origin+'/api/state')).status,401);
 assert.equal((await fetch(app.origin+'/api/state',{headers:{Authorization:'Bearer '+app.token,Origin:'https://unrelated.example'}})).status,403);
 const headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
 const task=await (await fetch(app.origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify(request('Output'))})).json();
 await settled(async()=>({data:await(await fetch(app.origin+'/api/state',{headers})).json()}));
 const state=await (await fetch(app.origin+'/api/state',{headers})).text();assert.ok(!state.includes('private-reference'));assert.ok(!state.includes('c2F2ZWQ='));
 const file=await fetch(app.origin+'/api/file?task='+task.id+'&name=result.txt',{headers});assert.equal(await file.text(),'saved');
});

test('failed execution records failure and never invents completion',async t=>{
 const f=await fixture(t,async()=>{throw Error('private provider detail');});
 await f.call('tasks',request('Failure fixture'));
 const s=await settled(f.call);
 assert.deepEqual(s.tasks[0].events.map(e=>e.kind),['queued','started','failed']);
 assert.ok(!JSON.stringify(s).includes('private provider detail'));
 await f.restart();assert.deepEqual((await settled(f.call)).tasks[0].events.map(e=>e.kind),['queued','started','failed']);
});
