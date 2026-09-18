// Read-only access to complete retained /workspace snapshots, never host paths.
export function validWorkspacePath(name){return typeof name==='string'&&name.length<=1088&&name.split('/').every(part=>part!=='.'&&part!=='..'&&/^[a-zA-Z0-9.][a-zA-Z0-9 ._-]{0,119}$/.test(part));}
export function workspaceView(state,id){
 const conversation=state.conversations.find(c=>c.id===id);
 if(!conversation)return null;
 const entries=(conversation.workspace||[]).filter(f=>validWorkspacePath(f.name));
 return {conversationId:id,title:conversation.title,capturedAt:conversation.workspaceCapturedAt||null,continuation:conversation.continuation,working:state.tasks.some(t=>t.conversationId===id&&['running','queued','cancelling'].includes(t.status)),entries:entries.map(f=>({name:f.name,directory:!!f.directory,size:f.directory?null:Buffer.from(f.data,'base64').length,modifiedAt:f.modifiedAt||null}))};
}
export function workspaceFile(state,id,name){
 if(!validWorkspacePath(name))return null;
 return state.conversations.find(c=>c.id===id)?.workspace?.find(f=>f.name===name&&!f.directory)||null;
}
