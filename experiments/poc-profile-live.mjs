// Explicit live probe: uses the configured subscription/runtime, never the retained POC store.
import {createPocServer} from '../apps/poc/server.mjs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const directory=await mkdtemp(tmpdir()+'/agent-context-live-');let app=await createPocServer({directory,port:0});
const call=async(path,data)=>{const r=await fetch(app.origin+'/api/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});assert.ok(r.ok,'HTTP '+r.status);return r.json();};
async function turn(prompt,conversationId){const task=await call('tasks',{prompt,conversationId,files:[],requestKey:randomUUID()});for(let i=0;i<300;i++){const s=await call('state');const current=s.tasks.find(t=>t.id===task.id);if(!s.active&&current.status!=='queued'){assert.equal(current.status,'completed');return current;}await delay(1000);}throw Error('Live probe timed out');}
try{
 const profile=await call('agent',{action:'remember',revision:0,text:'My preferred measurement system is metric. For the synthetic acceptance check, my preference marker is violet-cobalt-729.'});
 const first=await turn('Create marker.txt containing exactly RETAINED. Tell me my preferred measurement system and preference marker.');assert.match(first.answer,/metric/i);assert.match(first.answer,/violet-cobalt-729/);
 const before=JSON.parse(await readFile(directory+'/state.json','utf8')).conversations[0].session.threadId;
 await call('agent',{action:'forget',revision:1,id:profile.memories[0].id});await app.shutdown();app=await createPocServer({directory,port:0});
 const second=await turn('Read marker.txt and report its contents. What is my preferred measurement system and preference marker? If unknown, say unknown; do not guess.',first.conversationId);
 assert.match(second.answer,/RETAINED/);assert.match(second.answer,/unknown/i);assert.doesNotMatch(second.answer,/violet-cobalt-729/);
 const after=JSON.parse(await readFile(directory+'/state.json','utf8')).conversations[0].session.threadId;assert.notEqual(before,after);
 assert.equal((await call('agent')).memories.length,0);
 console.log(JSON.stringify({result:'passed',liveTurns:2,approvedPreferenceUsed:true,deletedPreferenceAbsent:true,providerSessionReplaced:true,restart:true,workspaceRetained:true}));
}finally{await app.shutdown();await rm(directory,{recursive:true,force:true});}
