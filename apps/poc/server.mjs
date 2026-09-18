import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { executeTask } from './runtime.mjs';
import { openStore, admit, publicTask, publicConversation } from './conversations.mjs';

export async function createPocServer({directory=fileURLToPath(new URL('../../.local/poc/',import.meta.url)),port=Number(process.env.PORT||4317),execute=executeTask}={}) {
let state,save,healthy;
const token=randomBytes(32).toString('hex');
let origin,active=null,closing=false,admissions=Promise.resolve();
function pump(){
  if(active||closing||!healthy())return;
  const task=state.tasks.find(t=>t.status==='queued');if(!task)return;
  const conversation=state.conversations.find(c=>c.id===task.conversationId);
  const control={id:task.id,stop:null};active=control;
  control.done=(async()=>{
    if(conversation.continuation!=='ready'){
      task.status='failed';task.activity='Continuation unavailable';task.error='Start a new chat; earlier work is preserved.';return;
    }
    task.status='running';task.activity='Connecting';await save();
    await execute(task,save,control,conversation);
  })().catch(()=>{
    task.status='failed';task.activity='Needs attention';task.error='The turn could not finish safely. Start a new chat.';conversation.continuation='unavailable';
  }).finally(async()=>{try{await save();}finally{active=null;pump();}});
  control.done.catch(()=>{});
}
function authorized(req) {const supplied=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
function send(res,code,data){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8*1024*1024)throw Error('Request too large');}return JSON.parse(text);}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    if(!state)return send(res,503,{error:'The local service is starting.'});
    const url=new URL(req.url,origin);
    if(req.headers.host!=='127.0.0.1:'+port || (req.headers.origin && req.headers.origin!==origin)) return send(res,403,{error:'This app is available only from its local address.'});
    if(url.pathname.startsWith('/api/')){
      if(!authorized(req)) return send(res,401,{error:'Open the local app link printed by the server.'});
      if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{tasks:state.tasks.map(publicTask),conversations:state.conversations.map(publicConversation),active:active?.id??null});
      if(req.method==='POST'&&url.pathname==='/api/tasks'){
        const data=await body(req);
        const action=admissions.then(async()=>{
          if(closing||!healthy())return send(res,503,{error:'The local service is unavailable. Your saved work is preserved.'});
          const {task}=admit(state,data);await save();send(res,202,publicTask(task));pump();
        });
        admissions=action.catch(()=>{});await action;return;
      }
      if(req.method==='POST'&&url.pathname==='/api/stop'){
        const data=await body(req);const task=state.tasks.find(t=>t.id===data.taskId);
        if(!task)return send(res,404,{error:'Task not found.'});
        if(task.status==='queued'){task.status='cancelled';task.activity='Stopped before execution';await save();return send(res,200,{stopped:true});}
        if(active?.id!==task.id||!active.stop||!['running','cancelling'].includes(task.status))return send(res,409,{error:'This turn cannot be stopped yet. Try again in a moment.'});
        const control=active;task.status='cancelling';task.activity='Stopping';await save();
        if(active!==control||!control.stop)return send(res,200,{finished:true});
        await control.stop();
        return send(res,202,{requested:true});
      }
      if(req.method==='GET'&&url.pathname==='/api/file'){
        const task=state.tasks.find(t=>t.id===url.searchParams.get('task'));
        const f=task?.artifacts.find(f=>f.name===url.searchParams.get('name'));
        if(!f)return send(res,404,{error:'File not found.'});
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(f.name),'Cache-Control':'no-store'});return res.end(Buffer.from(f.data,'base64'));
      }
      return send(res,404,{error:'Not found.'});
    }
    const assets={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/brain.svg':'brain.svg'};
    if(req.method!=='GET'||!assets[url.pathname])return send(res,404,{error:'Not found.'});
    const file=assets[url.pathname];res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');
    res.end(await readFile(new URL('./public/'+file,import.meta.url)));
  }catch(e){if(!res.headersSent)return send(res,e.status||500,{error:e.status?e.message:'The request could not be completed.'});}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
port=server.address().port;origin='http://127.0.0.1:'+port;
try{({state,save,healthy}=await openStore(directory));}catch(e){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw e;}
pump();
async function shutdown(){if(closing)return;closing=true;await admissions;const running=active;if(running)running.cancelRequested=true;if(running?.stop)await running.stop().catch(()=>{});if(running?.done)await running.done.catch(()=>{});await save();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
return {origin,token,shutdown};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const app=await createPocServer();console.log(app.origin+'/#'+app.token);
  process.on('SIGINT',()=>app.shutdown());process.on('SIGTERM',()=>app.shutdown());
}
