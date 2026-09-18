import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { executeTask, safeName } from './runtime.mjs';

const directory = fileURLToPath(new URL('../../.local/poc/',import.meta.url));
await mkdir(directory,{recursive:true,mode:0o700});
let state = {tasks:[]};
try {state=JSON.parse(await readFile(directory+'state.json','utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
for(const task of state.tasks) if(task.status==='running') {task.status='interrupted';task.activity='Service restarted';task.error='This task was interrupted. Start a new task to continue.';}
const token=randomBytes(32).toString('hex'), port=Number(process.env.PORT||4317), origin='http://127.0.0.1:'+port;
let active=null, saving=Promise.resolve();
const save=()=>{const text=JSON.stringify(state);saving=saving.then(async()=>{await writeFile(directory+'state.tmp',text,{mode:0o600});await rename(directory+'state.tmp',directory+'state.json');});return saving;};
await save();
function authorized(req) {const supplied=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
function send(res,code,data){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8*1024*1024)throw Error('Request too large');}return JSON.parse(text);}
const publicTask=t=>({...t,inputs:t.inputs.map(f=>({name:f.name})),artifacts:t.artifacts.map(f=>({name:f.name,size:Buffer.from(f.data,'base64').length}))});
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const url=new URL(req.url,origin);
    if(req.headers.host!=='127.0.0.1:'+port || (req.headers.origin && req.headers.origin!==origin)) return send(res,403,{error:'This app is available only from its local address.'});
    if(url.pathname.startsWith('/api/')){
      if(!authorized(req)) return send(res,401,{error:'Open the local app link printed by the server.'});
      if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,{tasks:state.tasks.map(publicTask),active:active?.id??null});
      if(req.method==='POST'&&url.pathname==='/api/tasks'){
        if(closing)return send(res,503,{error:'The local service is stopping.'});
        if(active)return send(res,409,{error:'Wait for the current task or stop it first.'});
        const data=await body(req);
        if(active)return send(res,409,{error:'Wait for the current task or stop it first.'});
        if(state.tasks.length>=30)return send(res,409,{error:'This local POC holds up to 30 tasks. Your existing results are preserved.'});
        if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>16000) return send(res,400,{error:'Enter a request of up to 16,000 characters.'});
        if(!Array.isArray(data.files)||data.files.length>5)return send(res,400,{error:'Attach up to five files.'});
        const names=new Set();let size=0;
        for(const f of data.files){if(!safeName(f.name)||names.has(f.name)||typeof f.data!=='string'||! /^[A-Za-z0-9+/]*={0,2}$/.test(f.data))return send(res,400,{error:'Use unique filenames with letters, numbers, spaces, dots, dashes or underscores.'});names.add(f.name);const bytes=Buffer.from(f.data,'base64').length;size+=bytes;if(bytes>2*1024*1024||size>5*1024*1024)return send(res,400,{error:'Files must be under 2 MB each and 5 MB combined.'});}
        const task={id:randomUUID(),prompt:data.prompt.trim(),inputs:data.files,artifacts:[],answer:'',status:'running',activity:'Connecting',createdAt:new Date().toISOString()};
        state.tasks.push(task);const control={id:task.id,stop:null};active=control;await save();
        control.done = executeTask(task,()=>{},control).finally(async()=>{active=null;await save();});
        control.done.catch(()=>{});
        return send(res,202,publicTask(task));
      }
      if(req.method==='POST'&&url.pathname==='/api/stop'){
        if(!active)return send(res,409,{error:'No task is running.'});
        if(!active.stop)return send(res,409,{error:'The task is starting. Try Stop again in a moment.'});
        await active.stop();return send(res,200,{stopped:true});
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
  }catch{return send(res,400,{error:'The request could not be completed.'});}
});
server.listen(port,'127.0.0.1',()=>console.log(origin+'/#'+token));
let closing=false;
async function shutdown(){if(closing)return;closing=true;const running=active;if(running?.stop)await running.stop().catch(()=>{});if(running?.done)await running.done.catch(()=>{});await save();server.close();server.closeAllConnections();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
