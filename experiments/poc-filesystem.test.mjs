import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { workspaceView,workspaceFile,validWorkspacePath } from '../apps/poc/filesystem.mjs';
import { browseWorkspace,breadcrumbs,readPreferences } from '../apps/poc/public/file-browser.js';
import { createPocServer } from '../apps/poc/server.mjs';
const entries=[{name:'nested',directory:true},{name:'nested/helper.js',data:Buffer.from('helper').toString('base64'),modifiedAt:'2026-01-01T00:00:00.000Z'},{name:'.notes',data:Buffer.from('notes').toString('base64')},{name:'input.csv',data:Buffer.from('input').toString('base64')}];
test('workspace projection includes inputs, intermediate files and dotfiles without provider data',()=>{
 const state={conversations:[{id:'a',workspace:entries,session:'PRIVATE',title:'A'}],tasks:[]};
 const view=workspaceView(state,'a');assert.equal(view.entries.length,4);assert.equal(view.entries[1].size,6);assert.ok(!JSON.stringify(view).includes('PRIVATE'));assert.ok(!JSON.stringify(view).includes('data'));assert.equal(workspaceFile(state,'a','nested/helper.js').data,entries[1].data);
 for(const path of ['../secret','nested/../secret','/etc/passwd','nested//file','nested/./file','a\\b','\u0000','']){assert.equal(validWorkspacePath(path),false,path);assert.equal(workspaceFile(state,'a',path),null);}
 assert.equal(workspaceFile(state,'b','input.csv'),null);assert.equal(workspaceFile(state,'a','nested'),null);
});
test('folder navigation, recursive search, hidden files and numeric ordering',()=>{
 const metadata=[...entries,{name:'item10.txt'},{name:'item2.txt'}];
 assert.deepEqual(browseWorkspace(metadata,'nested').map(e=>e.name),['nested/helper.js']);
 assert.deepEqual(browseWorkspace(metadata,'','HELPER').map(e=>e.name),['nested/helper.js']);
 assert.equal(browseWorkspace(metadata,'','',false).some(e=>e.name==='.notes'),false);
 assert.ok(browseWorkspace(metadata).findIndex(e=>e.name==='item2.txt')<browseWorkspace(metadata).findIndex(e=>e.name==='item10.txt'));
 assert.deepEqual(breadcrumbs('nested/deep'),[{name:'workspace',path:''},{name:'nested',path:'nested'},{name:'deep',path:'nested/deep'}]);
});
test('file preferences validate stored values and recover from malformed storage',()=>{
 assert.deepEqual(readPreferences({getItem:()=>'{'}),{layouts:{},sort:'newest',opened:{}});
 const result=readPreferences({getItem:()=>JSON.stringify({layouts:{documents:'grid',web:'list',bad:'anything'},sort:'opened',opened:{good:1,bad:'x'}})});
 assert.deepEqual(result,{layouts:{documents:'grid',web:'list'},sort:'opened',opened:{good:1}});
});
test('workspace endpoints are authenticated, exact-scoped and durable across restart',async()=>{
 const directory=await mkdtemp(tmpdir()+'/agentmeld-workspace-api-');let app;
 const execute=async(t,save,control,c)=>{c.workspace=entries;c.workspaceCapturedAt='2026-01-01T00:00:00.000Z';t.status='completed';};
 try{
 app=await createPocServer({directory,port:0,execute});
 let headers={Authorization:'Bearer '+app.token,'Content-Type':'application/json'};
 const task=await(await fetch(app.origin+'/api/tasks',{method:'POST',headers,body:JSON.stringify({prompt:'Fixture',files:[],requestKey:randomUUID()})})).json();
 for(let i=0;i<100;i++){const s=await(await fetch(app.origin+'/api/state',{headers})).json();if(!s.active&&!s.tasks.some(t=>t.status==='queued'))break;await new Promise(r=>setTimeout(r,10));}
 const path='/api/workspace?conversation='+task.conversationId;
 assert.equal((await fetch(app.origin+path)).status,401);assert.equal((await fetch(app.origin+path,{headers:{...headers,Origin:'https://example.com'}})).status,403);
 let response=await fetch(app.origin+path,{headers});assert.equal((await response.json()).entries.length,4);
 const filePath='/api/workspace/file?conversation='+task.conversationId+'&name=';
 assert.equal(await(await fetch(app.origin+filePath+'nested%2Fhelper.js',{headers})).text(),'helper');
 for(const name of ['..%2Fsecret','%2Fetc%2Fpasswd','nested','absent'])assert.equal((await fetch(app.origin+filePath+name,{headers})).status,404);
 assert.equal((await fetch(app.origin+'/api/workspace?conversation=missing',{headers})).status,404);
 await app.shutdown();app=await createPocServer({directory,port:0,execute});headers={Authorization:'Bearer '+app.token};
 assert.equal((await(await fetch(app.origin+path,{headers})).json()).entries.length,4);
 }finally{if(app)await app.shutdown();await rm(directory,{recursive:true,force:true});}
});
