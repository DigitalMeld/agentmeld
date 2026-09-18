export const busy=status=>['queued','running','cancelling'].includes(status);
export function chatInfo(state,conversation){
  const turns=state.tasks.filter(t=>t.conversationId===conversation.id);
  return {count:turns.length,latest:turns.at(-1)?.createdAt||conversation.createdAt,status:turns.find(t=>busy(t.status))?.status||turns.at(-1)?.status||'empty'};
}
export function orderedChats(state,archived,query=''){
  return state.conversations.filter(c=>!!c.archived===archived&&c.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||chatInfo(state,b).latest.localeCompare(chatInfo(state,a).latest)||a.id.localeCompare(b.id));
}
export function outputEntries(state){
  const versions=new Map();
  return state.tasks.flatMap(task=>task.artifacts.map(file=>{
    const key=JSON.stringify([task.conversationId,file.name]);const version=(versions.get(key)||0)+1;versions.set(key,version);
    return {task,file,version,title:state.conversations.find(c=>c.id===task.conversationId)?.title||'Conversation'};
  }));
}
export function visibleOutputs(state,query='',type='all',sort='newest'){
  const q=query.trim().toLocaleLowerCase();
  const entries=outputEntries(state).filter(e=>(e.file.name+' '+e.title).toLocaleLowerCase().includes(q)&&(type==='all'||e.file.name.toLowerCase().endsWith('.'+type)));
  return entries.sort((a,b)=>sort==='name'?a.file.name.localeCompare(b.file.name)||b.task.createdAt.localeCompare(a.task.createdAt):sort==='size'?b.file.size-a.file.size:sort==='oldest'?a.task.createdAt.localeCompare(b.task.createdAt):b.task.createdAt.localeCompare(a.task.createdAt));
}
export function conversationExport(state,id,format){
  const conversation=state.conversations.find(c=>c.id===id);if(!conversation)throw Error('Conversation unavailable.');
  // Explicit projection: never include provider sessions, workspace bytes or request keys.
  const data={format:'agentmeld-transcript-v1',conversation:{id,title:conversation.title,createdAt:conversation.createdAt},turns:state.tasks.filter(t=>t.conversationId===id).map(t=>({id:t.id,createdAt:t.createdAt,prompt:t.prompt,answer:t.answer,status:t.status,inputs:t.inputs.map(f=>({name:f.name})),outputs:t.artifacts.map(f=>({name:f.name,size:f.size}))}))};
  if(format==='json')return JSON.stringify(data,null,2);
  if(format!=='md')throw Error('Unknown export format.');
  return '# '+conversation.title+'\n\n'+data.turns.map(t=>'## '+t.createdAt+' · '+t.status+'\n\n### You\n\n'+t.prompt+'\n\n### AgentMeld\n\n'+(t.answer||'(No reply recorded)')+'\n\n'+(t.inputs.length?'Attachments: '+t.inputs.map(f=>f.name).join(', ')+'\n\n':'')+(t.outputs.length?'Outputs: '+t.outputs.map(f=>f.name).join(', ')+'\n\n':'')).join('---\n\n');
}
