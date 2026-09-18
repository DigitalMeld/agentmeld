import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { recordEvent,publicEvents } from '../apps/poc/events.mjs';
import { openStore,publicTask } from '../apps/poc/conversations.mjs';
test('milestones are ordered, deduplicated and project no arbitrary payload',()=>{
 const task={id:'run',events:[]};recordEvent(task,'queued');recordEvent(task,'started');recordEvent(task,'started');
 task.events[0].secret='must not be exposed';
 assert.deepEqual(publicEvents(task).map(e=>e.kind),['queued','started']);
 assert.ok(!JSON.stringify(publicEvents(task)).includes('secret'));
 assert.throws(()=>recordEvent(task,'raw-provider-error'));
 assert.deepEqual(publicEvents({}),[]);
});
test('restart preserves milestones and records interruption without inventing completion',async()=>{
 const directory=await mkdtemp(tmpdir()+'/agentmeld-events-');
 try{
 const {state,save}=await openStore(directory);
 const task={id:'run',conversationId:'chat',status:'running',inputs:[],artifacts:[]};
 recordEvent(task,'queued');recordEvent(task,'started');state.tasks.push(task);state.conversations.push({id:'chat',continuation:'ready'});await save();
 const reopened=await openStore(directory);
 assert.deepEqual(publicTask(reopened.state.tasks[0]).events.map(e=>e.kind),['queued','started','interrupted']);
 assert.equal(reopened.state.tasks[0].status,'interrupted');
 const again=await openStore(directory);assert.equal(again.state.tasks[0].events.length,3);
 }finally{await rm(directory,{recursive:true,force:true});}
});
