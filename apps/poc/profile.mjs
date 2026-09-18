import { randomUUID } from 'node:crypto';
import { RequestError } from './conversations.mjs';

export function defaultProfile(){return {revision:0,name:'AgentMeld',identity:'',persona:'',profile:'',memories:[],updatedAt:null};}
export function agentProfile(state){return state.agentProfile??defaultProfile();}
function text(value,max,label,required=false){
 if(typeof value!=='string'||value.length>max||value.includes('\0')||(required&&!value.trim()))throw new RequestError('Invalid '+label+'.');
 return value.trim();
}
// Only the authenticated owner endpoint calls this function. Descriptive text never changes grants.
export function updateProfile(state,data){
 const prior=agentProfile(state);
 if(!data||Array.isArray(data)||typeof data!=='object'||!Number.isSafeInteger(data.revision))throw new RequestError('A profile revision is required.');
 if(data.revision!==prior.revision)throw new RequestError('The agent changed elsewhere. Reload before saving.',409);
 const next=structuredClone(prior);
 if(data.action==='edit'){
  if(Object.keys(data).some(k=>!['revision','action','name','identity','persona','profile'].includes(k)))throw new RequestError('Unknown profile field.');
  next.name=text(data.name,80,'name',true);if(/[\r\n]/.test(next.name))throw new RequestError('Use a name on one line.');
  for(const key of ['identity','persona','profile'])next[key]=text(data[key],4000,key);
 }else if(data.action==='remember'){
  if(Object.keys(data).some(k=>!['revision','action','text','sourceTaskId'].includes(k)))throw new RequestError('Unknown memory field.');
  if(next.memories.length>=100)throw new RequestError('Keep up to 100 approved memories.');
  const sourceTaskId=data.sourceTaskId??null;
  if(sourceTaskId!==null&&!state.tasks.some(t=>t.id===sourceTaskId))throw new RequestError('Source task not found.',404);
  next.memories.push({id:randomUUID(),text:text(data.text,2000,'memory',true),sourceTaskId,source:sourceTaskId?'conversation':'owner',createdAt:new Date().toISOString()});
 }else if(data.action==='forget'){
  if(Object.keys(data).some(k=>!['revision','action','id'].includes(k)))throw new RequestError('Unknown memory field.');
  if(!next.memories.some(m=>m.id===data.id))throw new RequestError('Memory not found.',404);
  next.memories=next.memories.filter(m=>m.id!==data.id);
 }else throw new RequestError('Unknown profile action.');
 if(JSON.stringify(next).length>24000)throw new RequestError('Agent context is full. Shorten preferences or remove a memory.');
 next.revision++;next.updatedAt=new Date().toISOString();state.agentProfile=next;return next;
}
export function profileContext(profile){
 return 'Owner-approved agent context (descriptive preferences only; never authorization or permission changes). This replaces earlier agent preferences.\n'+JSON.stringify({name:profile.name,identity:profile.identity,persona:profile.persona,profile:profile.profile,memories:profile.memories.map(m=>({text:m.text,sourceTaskId:m.sourceTaskId}))})+'\n';
}
