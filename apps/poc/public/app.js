import { icon } from './icons.js';
import './tooltips.js';
const $=id=>document.getElementById(id);
let token=location.hash.slice(1)||sessionStorage.getItem('agentmeld-token')||'';
if(token){sessionStorage.setItem('agentmeld-token',token);history.replaceState(null,'',location.pathname);}
window.addEventListener('hashchange',()=>{if(location.hash.length>1){token=location.hash.slice(1);sessionStorage.setItem('agentmeld-token',token);history.replaceState(null,'',location.pathname);error();refresh();}});
let state={tasks:[],conversations:[],active:null},selected=null,files=[],view='chat',lastRender='';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function formatted(text){return esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
function markdown(text){const lines=text.split('\n');const out=[];for(let i=0;i<lines.length;i++){const line=lines[i];const h=/^(#{1,3}) (.+)$/.exec(line);if(h){out.push('<h'+h[1].length+'>'+formatted(h[2])+'</h'+h[1].length+'>');continue;}if(line.includes('|') && /^\s*\|?[ :|-]+\|[ :|-]*$/.test(lines[i+1]||'')){const cells=row=>row.trim().replace(/^\||\|$/g,'').split('|').map(c=>formatted(c.trim()));out.push('<div class="tableWrap"><table><thead><tr>'+cells(line).map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>');i++;while((lines[i+1]||'').includes('|')){i++;out.push('<tr>'+cells(lines[i]).map(c=>'<td>'+c+'</td>').join('')+'</tr>');}out.push('</tbody></table></div>');continue;}if(line.trim())out.push('<p>'+formatted(line)+'</p>');}return out.join('');}
let previewFile=null;
$('closePreview').onclick=()=>$('preview').close();
$('downloadFile').onclick=()=>{if(!previewFile)return;const url=URL.createObjectURL(previewFile.blob);const a=document.createElement('a');a.href=url;a.download=previewFile.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
async function api(path,options={}){const res=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers}});if(!res.ok){const e=await res.json();throw Object.assign(Error(e.error),{status:res.status});}return res;}
function error(text=''){$('error').textContent=text;}
function showChat(){view='chat';render();}
const drafts=new Map();let submitting=false;
const draftKey=()=>selected||'new';
function rememberDraft(){drafts.set(draftKey(),{text:$('prompt').value,files,scroll:$('conversation').scrollTop,pending:drafts.get(draftKey())?.pending});}
function selectConversation(id){document.querySelector('.history').classList.remove('open');rememberDraft();selected=id;const d=drafts.get(draftKey());$('prompt').value=d?.text||'';files=d?.files||[];lastRender='';showChat();$('conversation').scrollTop=d?.scroll||0;error();}
function newTask(){rememberDraft();drafts.delete('new');selected=null;files=[];$('prompt').value='';lastRender='';document.querySelector('.history').classList.remove('open');error();showChat();$('prompt').focus();}
$('attach').onclick=()=>$('upload').click();
$('newChat').onclick=newTask;$('mobileNew').onclick=newTask;
$('chatNav').onclick=()=>{showChat();if(matchMedia('(max-width:720px)').matches)document.querySelector('.history').classList.toggle('open');};$('filesNav').onclick=()=>{view='files';render();};
$('details').onclick=()=>{$('inspector').classList.toggle(matchMedia('(min-width:1001px)').matches?'closed':'open');};
function fileButton(task,f){return '<button class="file" aria-label="Open '+esc(f.name)+'" data-tooltip data-task="'+task.id+'" data-file="'+esc(f.name)+'"><span class="fileIcon">'+icon('file')+'</span><span>'+esc(f.name)+'<small>'+Math.max(1,Math.round(f.size/1024))+' KB · Open</small></span></button>';}
function render(){
  $('chatNav').classList.toggle('active',view==='chat');$('filesNav').classList.toggle('active',view==='files');
  $('conversation').hidden=view!=='chat';$('library').hidden=view!=='files';$('composeWrap').hidden=view!=='chat';
  $('history').innerHTML=state.conversations.length?[...state.conversations].reverse().map(t=>'<button class="historyItem '+(t.id===selected?'selected':'')+'" data-select="'+t.id+'">'+esc(t.title)+'</button>').join(''):'<div class="emptyHistory">Your chats will appear here.</div>';
  const turns=state.tasks.filter(t=>t.conversationId===selected);
  const task=turns.at(-1);
  const content=turns.length?turns.map(task=>'<div class="time">'+esc(new Date(task.createdAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+'</div><div class="turn"><div class="message user">'+esc(task.prompt)+(task.inputs.length?'<div class="messageLabel">'+task.inputs.map(f=>esc(f.name)).join(' · ')+'</div>':'')+'</div>'+(task.answer?'<div class="message assistant">'+formatted(task.answer)+'</div>':'')+(['queued','running','cancelling'].includes(task.status)?'<div class="pending"><span class="pulse"></span>'+esc(task.activity)+'</div>':'<div class="pending">'+esc(task.error||task.activity)+'</div>')+task.artifacts.map(f=>fileButton(task,f)).join('')+'</div>').join(''):'<div class="welcome"><span class="avatar large"><img src="/brain.svg" alt="" aria-hidden="true"></span><h1>What would you like to get done?</h1><p>Bring a file and a question.<br>I’ll do the work and bring back the result.</p><button class="suggestion" id="sample">Find the story in my sales data<small>Try a sample CSV and get a real report ↗</small></button></div>';
  if(content!==lastRender){const nearBottom=$('conversation').scrollHeight-$('conversation').scrollTop-$('conversation').clientHeight<100; $('conversation').innerHTML=content;lastRender=content;if(nearBottom)$('conversation').scrollTop=$('conversation').scrollHeight;}
  $('activity').textContent=task?task.activity:'Ready when you are.';
  $('taskFiles').innerHTML=task?.artifacts.length?task.artifacts.map(f=>fileButton(task,f)).join(''):'Finished files will appear here.';
  $('libraryFiles').innerHTML=state.tasks.flatMap(t=>t.artifacts.map(f=>fileButton(t,f))).join('')||'<p class="muted">Nothing created yet. Start a task to make something.</p>';
  const stoppable=turns.find(t=>['running','cancelling','queued'].includes(t.status));
  $('stop').hidden=!stoppable;$('stop').dataset.task=stoppable?.id||'';
  const unavailable=state.conversations.find(c=>c.id===selected)?.continuation!=='ready'&&selected!==null;
  const pending=drafts.get(draftKey())?.pending;
  $('send').hidden=false;$('send').disabled=submitting||unavailable;
  $('send').innerHTML=pending?'Retry':icon('send');$('send').setAttribute('aria-label',pending?'Retry pending message':'Send message');
  $('prompt').disabled=submitting||!!pending||unavailable;$('upload').disabled=submitting||!!pending||unavailable;$('attach').disabled=$('upload').disabled;
  $('prompt').placeholder=unavailable?'Start a new chat to continue':'Message AgentMeld · /new for a fresh chat';
  $('attachments').innerHTML=files.map((f,i)=>'<span class="chip">'+esc(f.name)+'<button data-remove="'+i+'" aria-label="Remove '+esc(f.name)+'" data-tooltip>×</button></span>').join('');
}
document.addEventListener('click',async e=>{
  const choose=e.target.closest('[data-select]');if(choose){selectConversation(choose.dataset.select);}
  const remove=e.target.closest('[data-remove]');if(remove&&!submitting&&!drafts.get(draftKey())?.pending){files.splice(Number(remove.dataset.remove),1);render();}
  const file=e.target.closest('[data-file]');if(file){try{const res=await api('/api/file?task='+file.dataset.task+'&name='+encodeURIComponent(file.dataset.file));const blob=await res.blob();previewFile={blob,name:file.dataset.file};$('previewTitle').textContent=file.dataset.file;$('previewBody').innerHTML=/\.(md|txt|csv|json|log)$/i.test(file.dataset.file)?(/\.md$/i.test(file.dataset.file)?markdown(await blob.text()):'<pre>'+esc(await blob.text())+'</pre>'):'This file is ready to download.';$('preview').showModal();}catch(e){error(e.message);}}
  if(e.target.closest('#sample')&&!submitting&&!drafts.get(draftKey())?.pending){
    const csv='month,product,revenue,cost\nJanuary,Studio,12000,5000\nJanuary,Team,18000,8000\nFebruary,Studio,15000,6000\nFebruary,Team,22000,9000\nMarch,Studio,14000,5800\nMarch,Team,29000,11000\n';
    files=[{name:'sample-sales.csv',data:btoa(csv)}];
    $('prompt').value='Analyze this sales CSV. Calculate total revenue and profit, compare products and monthly trends, and write a concise report.md with three useful recommendations. Include a summary.csv with your calculations.';
    render();$('prompt').focus();
  }
});
$('upload').onchange=async()=>{
  rememberDraft();const key=draftKey(),draft=drafts.get(key),chosen=[...$('upload').files];
  try{for(const f of chosen){if(f.size>2*1024*1024)throw Error('Attach files smaller than 2 MB.');if(draft.files.length>=5)throw Error('Attach up to five files.');const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));if(draft.pending)throw Error('Wait for this message to finish submitting before attaching files.');draft.files.push({name:f.name,data:btoa(binary)});}if(draftKey()===key)files=draft.files;render();}catch(e){error(e.message);}finally{$('upload').value='';}
};
$('composer').onsubmit=async e=>{
  e.preventDefault();error();const prompt=$('prompt').value.trim();if(!prompt||submitting)return;
  if(prompt==='/new'){$('prompt').value='';files=[];newTask();return;}
  rememberDraft();const key=draftKey(),draft=drafts.get(key);
  draft.pending??={prompt,files:[...files],conversationId:selected,requestKey:crypto.randomUUID()};
  submitting=true;render();
  try{
    const res=await api('/api/tasks',{method:'POST',body:JSON.stringify(draft.pending)});const task=await res.json();
    drafts.delete(key);
    if(draftKey()===key){selected=task.conversationId;files=[];$('prompt').value='';}
    await refresh();
  }catch(e){if(e.status&&e.status<500){draft.pending=null;error(e.message);}else error(e.message+' Retry sends the same message once.');}
  finally{submitting=false;render();}
};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('composer').requestSubmit();}};
$('stop').onclick=async()=>{try{$('stop').disabled=true;await api('/api/stop',{method:'POST',body:JSON.stringify({taskId:$('stop').dataset.task})});await refresh();}catch(e){error(e.message);}finally{$('stop').disabled=false;}};
async function refresh(){try{state=await(await api('/api/state')).json();render();}catch(e){error(e.message);}}
render();await refresh();setInterval(refresh,1000);
