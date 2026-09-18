import {randomUUID,createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {RustAuthority} from '../../experiments/rust-browser-control.mjs';
import {RequestError} from './conversations.mjs';
const binary=fileURLToPath(new URL('../../target/debug/agentmeld-m0',import.meta.url));
const bounded=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!v.includes('\0');
export function commandProposal(frame,thread,events){
 const p=frame?.params;
 if(frame?.method!=='item/commandExecution/requestApproval'||!p||p.threadId!==thread||!bounded(p.turnId,256)||!bounded(p.itemId,256)||!events.some(e=>e.method==='turn/started'&&e.params?.threadId===thread&&e.params?.turn?.id===p.turnId))throw Error('Unbound approval');
 if(!bounded(p.command,8000)||p.cwd!=='/workspace'||(p.kind&&p.kind!=='command')||p.additionalPermissions!=null||p.networkApprovalContext!=null||p.environmentId!=null)throw Error('Unsupported approval scope');
 if(p.availableDecisions&&!p.availableDecisions.includes('accept'))throw Error('One-time approval unavailable');
 return {command:p.command,cwd:p.cwd,reason:typeof p.reason==='string'?p.reason.slice(0,2000):'',thread:p.threadId,turn:p.turnId,request:String(frame.id),item:p.itemId};
}
export function createApprovals({state,save,directory,isActive,ttl=120000}){
 const pending=new Map(),seen=new Set();let stopped=false,proposing=false;
 const records=()=>state.approvals??=[];
 async function recover(){for(const row of records())if(row.status==='pending'){row.status='interrupted';row.decidedAt=new Date().toISOString();}await save();}
 function list(){return records().map(r=>({...r}));}
 async function request(task,proposal){
  if(stopped||!isActive(task.id)||pending.size||proposing||records().length>=1000)return 'decline';
  const key=JSON.stringify([task.id,proposal.thread,proposal.turn,proposal.request]);if(seen.has(key))return 'decline';seen.add(key);proposing=true;
  const id=randomUUID(),action={tool:'native_command',target:task.id,arguments:{command:proposal.command,cwd:proposal.cwd}},scope={workspace:task.conversationId,worker:task.id,thread:proposal.thread,turn:proposal.turn,request:proposal.request};
  let slot,authority;
  try{
   await mkdir(directory+'/approvals',{recursive:true,mode:0o700});
   authority=await RustAuthority.open(binary,directory+'/approvals/'+id+'.jsonl');
   const snapshot=await authority.request({op:'propose',generation:authority.current.generation,action,scope,ttl_ms:ttl});
   const row={id,taskId:task.id,conversationId:task.conversationId,command:proposal.command,cwd:proposal.cwd,reason:proposal.reason,digest:createHash('sha256').update(JSON.stringify(action)).digest('hex'),status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(snapshot.approval.expires_at_ms).toISOString()};
   const result=new Promise(resolve=>{slot={row,authority,action,scope,approvalId:snapshot.approval.id,resolve,deciding:false};});pending.set(id,slot);records().push(row);await save();
   slot.timer=setTimeout(()=>decide({id,digest:row.digest,allow:false},'expired').catch(()=>{}),ttl);slot.timer.unref();
   if(stopped||!isActive(task.id))await decide({id,digest:row.digest,allow:false},'interrupted');
   return await result;
  }catch{if(slot){slot.row.status='interrupted';slot.resolve('decline');}return 'decline';}
  finally{if(slot)clearTimeout(slot.timer);pending.delete(id);proposing=false;await authority?.close();}
 }
 async function decide(data,forced=null){
  if(!data||Object.keys(data).some(k=>!['id','digest','allow'].includes(k))||typeof data.allow!=='boolean')throw new RequestError('Invalid approval decision.');
  const slot=pending.get(data.id);if(!slot||slot.deciding||slot.row.digest!==data.digest||slot.row.status!=='pending')throw new RequestError('This approval is no longer available.',409);
  slot.deciding=true;clearTimeout(slot.timer);
  try{
   const expired=Date.now()>=Date.parse(slot.row.expiresAt),active=isActive(slot.row.taskId);
   const allow=data.allow&&!forced&&!expired&&active;
   const decision=await slot.authority.request({op:'decide',approval_id:slot.approvalId,action:slot.action,scope:slot.scope,allow});
   const accepted=allow&&decision.decision==='allow';
   slot.row.status=forced||(!active?'interrupted':expired||decision.decision==='expired'?'expired':accepted?'approved':'denied');slot.row.decidedAt=new Date().toISOString();
   await save();slot.resolve(accepted?'accept':'decline');return {...slot.row};
  }catch{slot.row.status='interrupted';slot.resolve('decline');throw new RequestError('Approval could not be recorded safely.',503);}
 }
 async function cancel(taskId){for(const [id,s] of pending)if(s.row.taskId===taskId&&!s.deciding)await decide({id,digest:s.row.digest,allow:false},'interrupted').catch(()=>{});}
 async function close(){stopped=true;for(const s of pending.values())await cancel(s.row.taskId);}
 return {recover,list,request,decide,cancel,close};
}
