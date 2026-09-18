import { recordEvent, publicEvents } from './events.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { safeName } from './runtime.mjs';

export class RequestError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
export async function openStore(directory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  let state={version:2,tasks:[],conversations:[]}, original;
  try { original=await readFile(directory+'/state.json','utf8'); state=JSON.parse(original); }
  catch(e) { if(e.code!=='ENOENT') throw e; }
  if(!Array.isArray(state.tasks)) throw Error('Invalid task store');
  if(state.version!==2) {
    if(state.version!==undefined) throw Error('Unsupported store version');
    // Preserve original bytes before any migration; do not infer old native sessions.
    await writeFile(directory+'/state-v1-backup-'+randomUUID()+'.json',original,{flag:'wx',mode:0o600});
    state.conversations=state.tasks.map(t=>{
      t.conversationId=t.id;
      return {id:t.id,title:t.prompt,createdAt:t.createdAt,session:null,workspace:[],continuation:'legacy'};
    });
    state.version=2;
  }
  if(!Array.isArray(state.conversations)) throw Error('Invalid conversation store');
  for(const task of state.tasks) if(['running','cancelling'].includes(task.status)) {
    recordEvent(task,'interrupted');task.status='interrupted';task.activity='Interrupted by service restart';
    task.error='Execution was interrupted. Start a new chat; this conversation cannot safely resume.';
    const c=state.conversations.find(c=>c.id===task.conversationId);if(c)c.continuation='unavailable';
  }
  let saving=Promise.resolve(), failure=null;
  const save=()=>{
    if(failure)return Promise.reject(failure);
    const text=JSON.stringify(state);
    const next=saving.then(async()=>{
      await writeFile(directory+'/state.tmp',text,{mode:0o600});
      await rename(directory+'/state.tmp',directory+'/state.json');
    });
    saving=next.catch(e=>{failure=e;});return next;
  };
  await save();return {state,save,healthy:()=>!failure};
}
export function admit(state,data) {
  if(!data||typeof data!=='object')throw new RequestError('Invalid message.');
  if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>16000)throw new RequestError('Enter a request of up to 16,000 characters.');
  if(data.prompt.trim()==='/new')throw new RequestError('Use New chat to start a fresh conversation.');
  if(typeof data.requestKey!=='string'||!/^[a-f0-9-]{36}$/.test(data.requestKey))throw new RequestError('A request key is required. Refresh the app.');
  if(data.conversationId!=null && typeof data.conversationId!=='string')throw new RequestError('Invalid conversation.');
  if(!Array.isArray(data.files)||data.files.length>5)throw new RequestError('Attach up to five files.');
  const names=new Set();let size=0;
  for(const f of data.files){
    if(!f||Object.keys(f).some(k=>!['name','data'].includes(k))||!safeName(f.name)||names.has(f.name)||typeof f.data!=='string'||Buffer.from(f.data,'base64').toString('base64')!==f.data)throw new RequestError('Use unique, safe filenames and valid file data.');
    names.add(f.name);const bytes=Buffer.from(f.data,'base64').length;size+=bytes;
    if(bytes>2*1024*1024||size>5*1024*1024)throw new RequestError('Files must be under 2 MB each and 5 MB combined.');
  }
  const digest=createHash('sha256').update(JSON.stringify([data.conversationId??null,data.prompt.trim(),data.files])).digest('hex');
  const prior=state.tasks.find(t=>t.requestKey===data.requestKey);
  if(prior){if(prior.requestDigest!==digest)throw new RequestError('This request key already belongs to another message.',409);return {task:prior,duplicate:true};}
  if(state.tasks.length>=30)throw new RequestError('This local preview holds up to 30 turns. Existing results are preserved.',409);
  let conversation=state.conversations.find(c=>c.id===data.conversationId);
  if(data.conversationId&&!conversation)throw new RequestError('Conversation not found.',404);
  if(conversation?.archived)throw new RequestError('Restore this conversation before sending a message.',409);
  if(conversation && conversation.continuation!=='ready')throw new RequestError('This conversation cannot safely resume. Start a new chat; its history and files are preserved.',409);
  if(conversation && data.files.some(f=>(conversation.workspace.some(p=>p.name===f.name)||state.tasks.some(t=>t.conversationId===conversation.id&&['queued','running','cancelling'].includes(t.status)&&t.inputs.some(p=>p.name===f.name)))))throw new RequestError('A file with that name already exists in this chat. Rename the attachment to preserve earlier work.',409);
  const createdAt=new Date().toISOString();
  if(!conversation){conversation={id:randomUUID(),title:data.prompt.trim(),createdAt,session:null,workspace:[],continuation:'ready'};state.conversations.push(conversation);}
  const task={id:randomUUID(),conversationId:conversation.id,requestKey:data.requestKey,requestDigest:digest,prompt:data.prompt.trim(),inputs:data.files,artifacts:[],answer:'',status:'queued',activity:'Queued',createdAt};
  recordEvent(task,'queued');state.tasks.push(task);return {task,duplicate:false};
}
export const publicTask=t=>({id:t.id,conversationId:t.conversationId,prompt:t.prompt,answer:t.answer,status:t.status,activity:t.activity,error:t.error,createdAt:t.createdAt,events:publicEvents(t),inputs:t.inputs.map(f=>({name:f.name,size:Buffer.from(f.data,'base64').length})),artifacts:t.artifacts.map(f=>({name:f.name,size:Buffer.from(f.data,'base64').length}))});
export const publicConversation=c=>({id:c.id,title:c.title,createdAt:c.createdAt,continuation:c.continuation,pinned:!!c.pinned,archived:!!c.archived});

export function updateConversation(state,data){
  if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.id!=='string'||Object.keys(data).some(k=>!['id','title','pinned','archived'].includes(k)))throw new RequestError('Invalid conversation update.');
  const conversation=state.conversations.find(c=>c.id===data.id);
  if(!conversation)throw new RequestError('Conversation not found.',404);
  if(Object.hasOwn(data,'title')&&(typeof data.title!=='string'||!data.title.trim()||data.title.trim().length>120||/[\r\n\x00-\x1f]/.test(data.title)))throw new RequestError('Use a title of 1–120 characters on one line.');
  for(const key of ['pinned','archived'])if(Object.hasOwn(data,key)&&typeof data[key]!=='boolean')throw new RequestError('Invalid conversation setting.');
  if(data.archived&&state.tasks.some(t=>t.conversationId===data.id&&['queued','running','cancelling'].includes(t.status)))throw new RequestError('Wait for this conversation’s work to finish before archiving.',409);
  if(Object.hasOwn(data,'title'))conversation.title=data.title.trim();
  for(const key of ['pinned','archived'])if(Object.hasOwn(data,key))conversation[key]=data[key];
  return conversation;
}
