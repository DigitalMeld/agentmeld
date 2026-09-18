import test from 'node:test';import assert from 'node:assert/strict';
import {statusLabel,queueWait,activityExport,countLabel,showTurnStatus,dayLabel,chatSearch,activityTasks,duration,elapsedLabel,runExport,renderMarkdown,literalMatches} from '../apps/poc/public/conversation-tools.js';
const task={id:'t',conversationId:'c',createdAt:'2026-09-18T10:00:00Z',prompt:'A request',answer:'Result with needle',status:'completed',activity:'Finished',inputs:[],artifacts:[{name:'report.csv',size:7}],events:[{kind:'started',at:'2026-09-18T10:00:01Z'},{kind:'completed',at:'2026-09-18T10:01:05Z'}],secret:'excluded'};const conversation={id:'c',title:'Example'};const state={conversations:[conversation],tasks:[task]};
test('chat search includes answers and output names without crossing conversations',()=>{assert.match(chatSearch(state,conversation,'NEEDLE'),/needle/);assert.equal(chatSearch(state,conversation,'report.csv'),'report.csv');assert.equal(chatSearch(state,{id:'other',title:'Other'},'needle'),null);assert.equal(chatSearch(state,conversation,'no match'),null);});
test('activity combines filters, results, scope and order',()=>{assert.equal(activityTasks(state,{query:'needle',outputs:true}).length,1);assert.equal(activityTasks(state,{conversationId:'other'}).length,0);assert.equal(activityTasks(state,{filter:'active'}).length,0);assert.equal(activityTasks(state,{query:'report.csv'}).length,1);const older={...task,id:'old',createdAt:'2025-01-01'};assert.equal(activityTasks({...state,tasks:[older,task]},{oldest:true})[0].id,'old');});
test('duration uses recorded endpoints only and export excludes internals',()=>{assert.equal(duration(task),64000);assert.equal(elapsedLabel(duration(task)),'1m 4s');assert.equal(duration({...task,events:[]}),null);assert.equal(duration({...task,events:[...task.events].reverse().map(e=>({...e,at:e.kind==='started'?'2027-01-01':'2026-01-01'}))}),null);assert.ok(!JSON.stringify(runExport(task,'Example')).includes('excluded'));});
test('Markdown escapes active content and preserves fenced code and tables',()=>{const html=renderMarkdown('# Heading\n- First\n- Second\n\n```js\n<img onerror=evil()>\n```\n> Quote\n| A | B |\n|---|---|\n| 1 | 2 |\n<script>bad()</script>');assert.match(html,/<ul><li>First/);assert.match(html,/class="copyCode"/);assert.match(html,/&lt;img onerror=evil\(\)&gt;/);assert.match(html,/<table>/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img '));assert.match(renderMarkdown('```\nunclosed'),/unclosed<\/code>/);});

test('literal search preserves Unicode indices and treats regex punctuation literally',()=>{assert.deepEqual(literalMatches('İ alpha ALPHA','alpha'),[{index:2,length:5},{index:8,length:5}]);assert.deepEqual(literalMatches('[a] a.* [a]','[a]'),[{index:0,length:3},{index:8,length:3}]);assert.deepEqual(literalMatches('hello','.*'),[]);});

test('only older successful replies suppress status; unfinished and exceptional turns remain visible',()=>{
 assert.equal(showTurnStatus(task,false),false);assert.equal(showTurnStatus(task,true),true);
 for(const status of ['queued','running','cancelling','failed','cancelled','interrupted'])assert.equal(showTurnStatus({...task,status},false),true);
 assert.equal(showTurnStatus({...task,error:'Failure'},false),true);assert.equal(showTurnStatus({...task,answer:''},false),true);
});
test('day headings handle month and year boundaries in local time',()=>{
 const now=new Date(2026,0,1,12);assert.equal(dayLabel(new Date(2026,0,1,1),now),'Today');assert.equal(dayLabel(new Date(2025,11,31,23),now),'Yesterday');assert.match(dayLabel(new Date(2025,11,29),now),/2025/);
 assert.equal(countLabel(1,'turn'),'1 turn');assert.equal(countLabel(0,'matching chat'),'0 matching chats');
});

test('activity date, status, input and milestone filters compose without changing stored tasks',()=>{
 const now=new Date(2026,8,18,12),recent=new Date(2026,8,18,1).toISOString(),old=new Date(2026,8,10,12).toISOString();
 const tasks=[{...task,id:'done',createdAt:recent,inputs:[{name:'unique.csv'}],events:[{label:'Agent ready'}]},{...task,id:'stop',createdAt:recent,status:'cancelled'},{...task,id:'fail',createdAt:recent,status:'interrupted'},{...task,id:'old',createdAt:old}];const fixture={...state,tasks};
 assert.equal(activityTasks(fixture,{period:'today',now}).length,3);assert.equal(activityTasks(fixture,{period:'week',now}).length,3);
 assert.deepEqual(activityTasks(fixture,{filter:'stopped'}).map(t=>t.id),['stop']);assert.deepEqual(activityTasks(fixture,{filter:'failed'}).map(t=>t.id),['fail']);
 assert.equal(activityTasks(fixture,{query:'unique.csv',inputs:true}).length,1);assert.equal(activityTasks(fixture,{query:'agent ready'}).length,1);assert.equal(tasks.length,4);
});
test('recorded queue timing and filtered exports do not leak internal fields',()=>{
 assert.equal(queueWait(task),null);const timed={...task,events:[{kind:'queued',at:'2026-09-18T10:00:00Z'},{kind:'started',at:'2026-09-18T10:00:03Z'}]};assert.equal(queueWait(timed),3000);assert.equal(queueWait({...timed,events:[{kind:'queued',at:'bad'},timed.events[1]]}),null);
 const exported=JSON.parse(activityExport([task],state,'json'));assert.equal(exported.runs.length,1);assert.equal(exported.runs[0].run.id,'t');assert.ok(!JSON.stringify(exported).includes('excluded'));assert.match(activityExport([task],state,'md'),/# Activity/);assert.equal(statusLabel('cancelled'),'Stopped');assert.throws(()=>activityExport([],state,'html'));
});
