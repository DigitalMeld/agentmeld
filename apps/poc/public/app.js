import { chatInfo, orderedChats, outputEntries, visibleOutputs, conversationExport } from './organization.js';
import { formatBytes, validateAttachments } from './composer.js';
import { icon } from './icons.js';
import './tooltips.js';
const $=id=>document.getElementById(id);
let token=location.hash.slice(1)||sessionStorage.getItem('agentmeld-token')||'';
if(token){sessionStorage.setItem('agentmeld-token',token);history.replaceState(null,'',location.pathname);}
window.addEventListener('hashchange',()=>{if(location.hash.length>1){token=location.hash.slice(1);sessionStorage.setItem('agentmeld-token',token);history.replaceState(null,'',location.pathname);error();refresh();}});
let state={tasks:[],conversations:[],active:null},selected=null,files=[],view='chat',lastRender='';
let fileCategory='all',fileLayout='grid',fileChatOpen=false;
const categories={all:'All artifacts',documents:'Documents',web:'Web artifacts',images:'Images',videos:'Videos',audio:'Podcasts',system:'System files'};
const categoryExtensions={documents:['md','txt','csv','json','pdf','docx'],web:['html','htm'],images:['png','jpg','jpeg','gif','webp','svg'],videos:['mp4','mov','webm'],audio:['mp3','wav','m4a','ogg']};
let restoreSelection=true,lastHistory='',showArchived=false;
function saveSelection(){try{if(selected)sessionStorage.setItem('agentmeld-selection',selected);else sessionStorage.removeItem('agentmeld-selection');}catch{}}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function formatted(text){return esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
function markdown(text){const lines=text.split('\n');const out=[];for(let i=0;i<lines.length;i++){const line=lines[i];const h=/^(#{1,3}) (.+)$/.exec(line);if(h){out.push('<h'+h[1].length+'>'+formatted(h[2])+'</h'+h[1].length+'>');continue;}if(line.includes('|') && /^\s*\|?[ :|-]+\|[ :|-]*$/.test(lines[i+1]||'')){const cells=row=>row.trim().replace(/^\||\|$/g,'').split('|').map(c=>formatted(c.trim()));out.push('<div class="tableWrap"><table><thead><tr>'+cells(line).map(c=>'<th>'+c+'</th>').join('')+'</tr></thead><tbody>');i++;while((lines[i+1]||'').includes('|')){i++;out.push('<tr>'+cells(lines[i]).map(c=>'<td>'+c+'</td>').join('')+'</tr>');}out.push('</tbody></table></div>');continue;}if(line.trim())out.push('<p>'+formatted(line)+'</p>');}return out.join('');}
let previewFile=null,previewRequest=0,connected=false,refreshing=false,uploading=false,composing=false;
let noticeTimer;
function notice(text){(document.querySelector('dialog[open]')||document.body).append($('notice'));$('notice').textContent=text;$('notice').classList.remove('sr');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('notice').classList.add('sr');},3500);}
async function copyText(text){try{await navigator.clipboard.writeText(text);notice('Copied to clipboard.');}catch{notice('Could not copy. Select the text and copy it manually.');}}
$('copyPreview').onclick=()=>{if(previewFile?.text!==undefined)copyText(previewFile.text);};
let composerValue=null,composerWidth=0;
function resizeComposer(){const el=$('prompt');if(el.value===composerValue&&el.clientWidth===composerWidth)return;composerValue=el.value;composerWidth=el.clientWidth;el.style.height='auto';el.style.height=Math.min(140,el.scrollHeight)+'px';el.style.overflowY=el.scrollHeight>140?'auto':'hidden';}
function updateComposer(){
  const count=$('prompt').value.length;
  $('characterCount').hidden=count<14000;$('characterCount').textContent=count.toLocaleString()+' / 16,000';
  const pending=drafts.get(draftKey())?.pending;
  const unavailable=selected!==null&&state.conversations.find(c=>c.id===selected)?.continuation!=='ready'||!!state.conversations.find(c=>c.id===selected)?.archived;
  $('send').disabled=!connected||submitting||uploading||unavailable||($('prompt').disabled&&!pending)||!$('prompt').value.trim();resizeComposer();
}
$('prompt').addEventListener('input',updateComposer);window.addEventListener('resize',resizeComposer);
$('prompt').addEventListener('compositionstart',()=>{composing=true;});
$('prompt').addEventListener('compositionend',()=>{composing=false;updateComposer();});
$('retryConnection').onclick=()=>refresh();$('retryBanner').onclick=()=>refresh();

$('closePreview').onclick=()=>$('preview').close();
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
$('downloadFile').onclick=()=>{if(previewFile)downloadBlob(previewFile.blob,previewFile.name);};
async function api(path,options={}){const res=await fetch(path,{...options,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...options.headers}});if(!res.ok){const e=await res.json();throw Object.assign(Error(e.error),{status:res.status});}return res;}
function error(text=''){$('error').textContent=text;}
function showChat(){view='chat';render();}
const drafts=new Map();let submitting=false;
const draftKey=()=>selected||'new';
function rememberDraft(){const key=draftKey(),draft=drafts.get(key)||{};Object.assign(draft,{text:$('prompt').value,files,scroll:$('conversation').scrollTop});drafts.set(key,draft);}
function selectConversation(id){document.querySelector('.history').classList.remove('open');rememberDraft();selected=id;showArchived=!!state.conversations.find(c=>c.id===id)?.archived;saveSelection();const d=drafts.get(draftKey());$('prompt').value=d?.text||'';files=d?.files||[];lastRender='';showChat();$('conversation').scrollTop=d?.scroll||0;error();}
function newTask(){rememberDraft();drafts.delete('new');selected=null;showArchived=false;saveSelection();files=[];$('prompt').value='';lastRender='';document.querySelector('.history').classList.remove('open');error();showChat();$('prompt').focus();}
$('chatSearch').oninput=()=>render();$('fileSearch').oninput=()=>render();$('archiveChats').onclick=()=>{showArchived=!showArchived;render();};$('fileType').onchange=()=>render();$('fileSort').onchange=()=>render();$('activitySearch').oninput=()=>renderActivity();
$('attach').onclick=()=>$('upload').click();
$('newChat').onclick=newTask;$('mobileNew').onclick=newTask;
$('chatNav').onclick=()=>{showChat();if(matchMedia('(max-width:720px)').matches)document.querySelector('.history').classList.toggle('open');};$('filesNav').onclick=()=>{view='files';document.querySelector('.history').classList.remove('open');render();};
for(const button of document.querySelectorAll('[data-category]')){button.insertAdjacentHTML('afterbegin',icon(button.dataset.symbol));button.onclick=()=>{fileCategory=button.dataset.category;if(fileCategory==='documents')fileLayout='list';else if(fileCategory==='all')fileLayout='grid';$('fileType').value='all';$('fileSidebar').classList.remove('open');render();};}
for(const button of document.querySelectorAll('[data-layout]'))button.onclick=()=>{fileLayout=button.dataset.layout;render();};
$('libraryMenu').onclick=()=>$('fileSidebar').classList.toggle('open');
$('libraryChat').onclick=()=>{fileChatOpen=!fileChatOpen;render();if(fileChatOpen)$('prompt').focus();};
$('fileChatClose').onclick=()=>{fileChatOpen=false;render();$('libraryChat').focus();};
$('fileChatNew').onclick=()=>{newTask();view='files';fileChatOpen=true;render();$('prompt').focus();};
$('createArtifact').onclick=()=>{fileChatOpen=true;render();$('prompt').focus();};
$('activityFilter').onchange=()=>renderActivity();
$('closeActivity').onclick=()=>{$('inspector').classList.remove('open');$('inspector').classList.add('closed');$('details').focus();};
$('details').onclick=()=>{const panel=$('inspector');if(matchMedia('(min-width:1001px)').matches)panel.classList.toggle('closed');else{panel.classList.remove('closed');panel.classList.toggle('open');}};
function fileButton(task,f){return '<button class="file" aria-label="Open '+esc(f.name)+'" data-tooltip data-task="'+task.id+'" data-file="'+esc(f.name)+'"><span class="fileIcon">'+icon('file')+'</span><span>'+esc(f.name)+'<small>'+formatBytes(f.size)+' · Open</small></span></button>';}
let detailId=null,lastDetail='';
$('closeRun').onclick=()=>$('runDetails').close();
function jumpToTask(task){selectConversation(task.conversationId);$('inspector').classList.remove('open');const turn=$('turn-'+task.id);turn?.focus({preventScroll:true});turn?.scrollIntoView({block:'start',behavior:'instant'});}
$('runConversation').onclick=()=>{const task=state.tasks.find(t=>t.id===detailId);$('runDetails').close();if(task)jumpToTask(task);};
function renderDetails(){
  const task=state.tasks.find(t=>t.id===detailId);if(!task)return;
  const content='<p class="runPrompt">'+esc(task.prompt)+'</p><p>'+esc(task.status)+' · '+esc(task.error||task.activity)+'</p><h3>Recorded milestones</h3>'+((task.events||[]).length?'<ol class="milestones">'+task.events.map(e=>'<li><strong>'+esc(e.label)+'</strong><time>'+esc(new Date(e.at).toLocaleString())+'</time></li>').join('')+'</ol>':'<p class="muted">Milestones were not recorded for this older turn.</p>')+'<p class="muted">These are run milestones, not a complete command history.</p>';
  if(content!==lastDetail){$('runBody').innerHTML=content;lastDetail=content;}
}
let lastActivity='',lastLibrary='';
function renderActivity(){
  let day='';
  const filter=$('activityFilter').value;
  const matches=task=>filter==='all'||(filter==='active'?['queued','running','cancelling'].includes(task.status):filter==='attention'?['failed','interrupted','cancelled'].includes(task.status):task.status==='completed');
  const content=[...state.tasks].reverse().filter(matches).filter(task=>task.prompt.toLocaleLowerCase().includes($('activitySearch').value.trim().toLocaleLowerCase())).map(task=>{
    const date=new Date(task.createdAt), key=date.toLocaleDateString();
    const heading=key!==day?'<h3>'+esc(date.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}))+'</h3>':'';
    day=key;
    return heading+'<article class="activityEntry"><button class="activityLink" data-jump="'+task.id+'" aria-label="Open conversation: '+esc(task.prompt)+'"><strong>'+esc(task.prompt)+'</strong><span class="activityMeta">'+esc(task.status)+' · '+esc(date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))+'</span><span class="activitySummary">'+esc(task.error||task.activity)+'</span></button><button class="detailLink" data-detail="'+task.id+'">View details</button>'+task.artifacts.map(f=>fileButton(task,f)).join('')+'</article>';
  }).join('')||'<p class="muted">'+(filter==='all'&&!$('activitySearch').value.trim()?'Your activity will appear here.':'No matching activity.')+'</p>';
  // Polling must not replace a focused row or reset the panel when nothing changed.
  if(content!==lastActivity){$('activity').innerHTML=content;lastActivity=content;}
}
function render(){
  const inFiles=view==='files',chatVisible=!inFiles||fileChatOpen;
  document.body.classList.toggle('filesView',inFiles);document.body.classList.toggle('fileChatOpen',inFiles&&fileChatOpen);
  document.querySelector('.history').hidden=inFiles;$('fileSidebar').hidden=!inFiles;document.querySelector('.top').hidden=inFiles;$('inspector').hidden=inFiles;
  $('chatSurface').hidden=!chatVisible;$('fileChatHeader').hidden=!inFiles;
  $('libraryChat').setAttribute('aria-pressed',String(fileChatOpen));$('libraryChat').setAttribute('aria-label',fileChatOpen?'Hide chat':'Show chat');
  $('libraryTitle').textContent=categories[fileCategory];$('systemScope').hidden=fileCategory!=='system';
  $('createArtifact').hidden=fileCategory==='system';
  for(const b of document.querySelectorAll('[data-category]')){b.classList.toggle('selected',b.dataset.category===fileCategory);b.setAttribute('aria-current',b.dataset.category===fileCategory?'page':'false');}
  for(const b of document.querySelectorAll('[data-layout]'))b.setAttribute('aria-pressed',String(b.dataset.layout===fileLayout));
  $('libraryFiles').className=fileCategory==='system'?'systemTable':fileLayout==='grid'?'artifactGrid':'artifactList';
  $('chatHeading').textContent=showArchived?'Archived':'Chats';
  $('archiveChats').setAttribute('aria-pressed',String(showArchived));
  $('archiveChats').setAttribute('aria-label',showArchived?'Show active chats':'Show archived chats');
  $('chatNav').classList.toggle('active',view==='chat');$('filesNav').classList.toggle('active',view==='files');
  $('conversation').hidden=!chatVisible;$('library').hidden=view!=='files';$('composeWrap').hidden=!chatVisible;
  const chatQuery=$('chatSearch').value.trim().toLocaleLowerCase();
  const matchingChats=orderedChats(state,showArchived,chatQuery);
  const historyContent=matchingChats.length?matchingChats.map(t=>'<button class="historyItem '+(t.id===selected?'selected':'')+'" data-select="'+t.id+'"><span class="chatTitle">'+esc(t.title)+'</span><small>'+(t.pinned?'Pinned · ':'')+chatInfo(state,t).count+' turns · '+esc(chatInfo(state,t).status)+'</small></button>').join(''):'<div class="emptyHistory">'+(chatQuery?'No matching chats.':showArchived?'No archived chats.':'Your chats will appear here.')+'</div>';
  if(historyContent!==lastHistory){$('history').innerHTML=historyContent;lastHistory=historyContent;}
  const current=state.conversations.find(c=>c.id===selected);
  $('chatToolbar').hidden=!current||!chatVisible;$('selectedTitle').textContent=current?.title||'';
  $('chatSummary').textContent=current?chatInfo(state,current).count+' turns':'';
  $('readOnlyBanner').hidden=!current||!chatVisible||(!current.archived&&current.continuation==='ready');
  $('readOnlyReason').textContent=current?.archived?'This chat is archived.':current?.continuation==='legacy'?'This older chat is read-only. Its history and files are preserved.':'This chat cannot safely resume. Its history and files are preserved.';
  $('restoreChat').hidden=!current?.archived;
  const turns=state.tasks.filter(t=>t.conversationId===selected);
  const task=turns.at(-1);
  const content=turns.length?turns.map(task=>'<div class="time">'+esc(new Date(task.createdAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+'</div><div class="turn" id="turn-'+task.id+'" tabindex="-1"><div class="message user">'+esc(task.prompt)+(task.inputs.length?'<div class="messageLabel">'+task.inputs.map(f=>'<button class="inputFile" data-input="'+task.id+'" data-name="'+esc(f.name)+'" aria-label="Download original '+esc(f.name)+'">'+esc(f.name)+' ↓</button>').join(' ')+'</div>':'')+'</div>'+(task.answer?'<div class="message assistant">'+formatted(task.answer)+'</div><button class="copyReply" data-copy-answer="'+task.id+'">Copy reply</button>':'')+(['queued','running','cancelling'].includes(task.status)?'<div class="pending"><span class="pulse"></span>'+esc(task.activity)+'</div>':'<div class="pending">'+esc(task.error||task.activity)+'</div>')+task.artifacts.map(f=>fileButton(task,f)).join('')+'</div>').join(''):'<div class="welcome"><span class="avatar large"><img src="/brain.svg" alt="" aria-hidden="true"></span><h1>What would you like to get done?</h1><p>Bring a file and a question.<br>I’ll do the work and bring back the result.</p><button class="suggestion" id="sample">Find the story in my sales data<small>Try a sample CSV and get a real report ↗</small></button></div>';
  if(content!==lastRender){const nearBottom=$('conversation').scrollHeight-$('conversation').scrollTop-$('conversation').clientHeight<100; $('conversation').innerHTML=content;lastRender=content;if(nearBottom)$('conversation').scrollTop=$('conversation').scrollHeight;}
  renderActivity();if($('runDetails').open)renderDetails();
  $('taskFiles').innerHTML=task?.artifacts.length?task.artifacts.map(f=>fileButton(task,f)).join(''):'Finished files will appear here.';
  const fileQuery=$('fileSearch').value.trim().toLocaleLowerCase();
  const outputs=visibleOutputs(state,fileQuery,$('fileType').value,$('fileSort').value).filter(e=>!categoryExtensions[fileCategory]||categoryExtensions[fileCategory].includes(e.file.name.split('.').pop().toLowerCase()));
  $('fileSummary').textContent=outputs.length+' outputs · '+formatBytes(outputs.reduce((sum,e)=>sum+e.file.size,0));
  const libraryContent=fileCategory==='system'?'<table><thead><tr><th>Name</th><th>Type</th><th>Created</th><th>Size</th></tr></thead><tbody>'+outputs.map(({task:t,file:f})=>'<tr><td>'+fileButton(t,f)+'</td><td>'+esc(f.name.split('.').pop().toUpperCase())+'</td><td>'+esc(new Date(t.createdAt).toLocaleDateString())+'</td><td>'+formatBytes(f.size)+'</td></tr>').join('')+'</tbody></table>'+(outputs.length?'':'<p class="muted">No retained workspace files.</p>'):outputs.map(({task:t,file:f,title,version})=>'<article class="libraryEntry"><button class="artifactThumbnail" data-task="'+t.id+'" data-file="'+esc(f.name)+'" aria-label="Preview '+esc(f.name)+'"><span class="thumbnailText" data-thumbnail-task="'+t.id+'" data-thumbnail-name="'+esc(f.name)+'">'+esc(f.name)+'</span></button>'+fileButton(t,f)+'<button class="outputOrigin" data-jump="'+t.id+'">'+esc(title)+' · Version '+version+' · '+esc(new Date(t.createdAt).toLocaleString())+'</button></article>').join('')||'<div class="libraryEmpty">'+icon('artifacts')+'<h2>'+(fileQuery?'No matching files':'Nothing created yet')+'</h2><p>Documents and other things you create will appear here.</p></div>';
  if(libraryContent!==lastLibrary){$('libraryFiles').innerHTML=libraryContent;lastLibrary=libraryContent;}
  if(inFiles)loadThumbnails();
  const stoppable=turns.find(t=>['running','cancelling','queued'].includes(t.status));
  $('stop').hidden=!stoppable;$('stop').dataset.task=stoppable?.id||'';
  const unavailable=state.conversations.find(c=>c.id===selected)?.continuation!=='ready'&&selected!==null||!!state.conversations.find(c=>c.id===selected)?.archived;
  const pending=drafts.get(draftKey())?.pending;
  $('send').hidden=false;$('send').disabled=submitting||unavailable;
  $('send').innerHTML=pending?'Retry':icon('send');$('send').setAttribute('aria-label',pending?'Retry pending message':'Send message');
  $('prompt').disabled=submitting||!!pending||unavailable;$('upload').disabled=submitting||uploading||!!pending||unavailable;$('attach').disabled=$('upload').disabled;
  $('prompt').placeholder='Message';
  $('attachments').innerHTML=files.map((f,i)=>'<span class="chip">'+esc(f.name)+' <small>'+formatBytes(atob(f.data).length)+'</small><button data-remove="'+i+'" aria-label="Remove '+esc(f.name)+'" data-tooltip>×</button></span>').join('');
  updateComposer();updateLatest();
}

const thumbnails=new Map();let loadingThumbnails=false;
async function loadThumbnails(){
  if(loadingThumbnails||!connected||$('libraryFiles').className!=='artifactGrid')return;
  loadingThumbnails=true;
  try{for(const el of [...document.querySelectorAll('[data-thumbnail-task]')].slice(0,24)){
    const key=JSON.stringify([el.dataset.thumbnailTask,el.dataset.thumbnailName]);
    if(thumbnails.has(key)){el.textContent=thumbnails.get(key);continue;}
    if(!/\.(md|txt|csv|json)$/i.test(el.dataset.thumbnailName))continue;
    const entry=state.tasks.find(t=>t.id===el.dataset.thumbnailTask)?.artifacts.find(f=>f.name===el.dataset.thumbnailName);
    if(!entry||entry.size>262144)continue;
    try{const response=await api('/api/file?task='+encodeURIComponent(el.dataset.thumbnailTask)+'&name='+encodeURIComponent(el.dataset.thumbnailName),{signal:AbortSignal.timeout(8000)});const text=(await response.text()).slice(0,3000);thumbnails.set(key,text);el.textContent=text;}catch{break;}
    if(view!=='files')break;
  }}finally{loadingThumbnails=false;}
}

let optionsBusy=false,previewRaw=false;
function selectedChat(){return state.conversations.find(c=>c.id===selected);}
function renderChatOptions(){const c=selectedChat();if(!c)return;$('chatName').value=c.title.slice(0,120);$('pinChat').textContent=c.pinned?'Unpin chat':'Pin chat';$('archiveChat').textContent=c.archived?'Restore chat':'Archive chat';}
$('chatOptionsButton').onclick=()=>{renderChatOptions();$('chatOptionsError').textContent='';$('chatOptions').showModal();};
$('closeChatOptions').onclick=()=>$('chatOptions').close();
async function changeChat(patch){
  if(optionsBusy||!selected)return;optionsBusy=true;
  for(const b of $('chatOptions').querySelectorAll('button'))b.disabled=true;
  $('chatOptionsError').textContent='';
  try{const c=await(await api('/api/conversations',{method:'POST',body:JSON.stringify({id:selected,...patch})})).json();
    state.conversations=state.conversations.map(old=>old.id===c.id?c:old);
    if(c.id===selected&&Object.hasOwn(patch,'archived'))showArchived=!!c.archived;
    render();renderChatOptions();notice('Chat updated.');
  }catch(e){$('chatOptionsError').textContent=e.message;if(!$('chatOptions').open)notice(e.message);}
  finally{optionsBusy=false;for(const b of $('chatOptions').querySelectorAll('button'))b.disabled=false;}
}
$('renameChat').onsubmit=e=>{e.preventDefault();changeChat({title:$('chatName').value});};
$('pinChat').onclick=()=>changeChat({pinned:!selectedChat()?.pinned});
$('archiveChat').onclick=()=>changeChat({archived:!selectedChat()?.archived});
$('restoreChat').onclick=()=>changeChat({archived:false});$('startFresh').onclick=newTask;
$('shortcutHelp').onclick=()=>$('shortcuts').showModal();$('closeShortcuts').onclick=()=>$('shortcuts').close();
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||document.querySelector('dialog[open]'))return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(view==='files'){$('fileSidebar').classList.add('open');$('fileSearch').focus();}else{document.querySelector('.history').classList.add('open');$('chatSearch').focus();}}
  if(e.key==='Escape'){if($('fileSidebar').classList.contains('open')){$('fileSidebar').classList.remove('open');$('libraryMenu').focus();}else if(view==='files'&&fileChatOpen){$('fileChatClose').click();}else if(document.querySelector('.history').classList.contains('open')){document.querySelector('.history').classList.remove('open');$('chatNav').focus();}else if($('inspector').classList.contains('open'))$('closeActivity').click();}
});
window.addEventListener('beforeunload',e=>{if($('prompt').value||files.length||[...drafts.entries()].some(([key,d])=>d.pending||(key!==draftKey()&&(d.text||d.files?.length)))){e.preventDefault();e.returnValue='';}});
function updateLatest(){$('latestBar').hidden=(view!=='chat'&&!fileChatOpen)||!selected||$('conversation').scrollHeight-$('conversation').scrollTop-$('conversation').clientHeight<150;}
$('conversation').addEventListener('scroll',updateLatest);
$('jumpLatest').onclick=()=>{$('conversation').scrollTo({top:$('conversation').scrollHeight,behavior:'instant'});updateLatest();};
function renderPreviewText(){if(!previewFile)return;const md=/\.md$/i.test(previewFile.name);$('previewSource').hidden=!md;$('previewSource').textContent=previewRaw?'View formatted Markdown':'View raw Markdown';$('previewBody').innerHTML=previewFile.text!==undefined?(md&&!previewRaw?markdown(previewFile.text):'<pre>'+esc(previewFile.text)+'</pre>'):'This file is ready to download.';}
$('previewSource').onclick=()=>{previewRaw=!previewRaw;renderPreviewText();};
$('previewConversation').onclick=()=>{const task=state.tasks.find(t=>t.id===previewFile?.taskId);$('preview').close();if(task)jumpToTask(task);};
$('previewVersion').onchange=()=>{if(previewFile){const next=$('previewVersion').value;$('previewVersion').value=previewFile.taskId;openPreview(next,previewFile.name);}};
async function openPreview(taskId,name){
  const request=++previewRequest;
  try{
    const res=await api('/api/file?task='+encodeURIComponent(taskId)+'&name='+encodeURIComponent(name));const blob=await res.blob();
    const isText=/\.(md|txt|csv|json|log)$/i.test(name);const text=isText?await blob.text():undefined;
    if(request!==previewRequest)return;
    previewFile={blob,name,text,taskId};previewRaw=false;$('previewTitle').textContent=name;
    const task=state.tasks.find(t=>t.id===taskId);
    $('previewOrigin').textContent=(state.conversations.find(c=>c.id===task?.conversationId)?.title||'Conversation')+' · '+(task?new Date(task.createdAt).toLocaleString():'')+' · '+formatBytes(blob.size);
    const versions=outputEntries(state).filter(e=>e.task.conversationId===task?.conversationId&&e.file.name===name);
    $('versionLabel').hidden=versions.length<2;
    $('previewVersion').innerHTML=versions.map(e=>'<option value="'+e.task.id+'">Version '+e.version+' · '+esc(new Date(e.task.createdAt).toLocaleString())+'</option>').join('');$('previewVersion').value=taskId;
    $('copyPreview').hidden=!isText;renderPreviewText();
    if(!$('preview').open)$('preview').showModal();
  }catch(e){if(request===previewRequest)notice(e.message);}
}

document.addEventListener('click',async e=>{
  const copy=e.target.closest('[data-copy-answer]');if(copy){const task=state.tasks.find(t=>t.id===copy.dataset.copyAnswer);if(task)await copyText(task.answer);}
  const jump=e.target.closest('[data-jump]');if(jump){const task=state.tasks.find(t=>t.id===jump.dataset.jump);if(task){jumpToTask(task);}}
  const detail=e.target.closest('[data-detail]');if(detail){detailId=detail.dataset.detail;renderDetails();$('runDetails').showModal();}
  const choose=e.target.closest('[data-select]');if(choose){selectConversation(choose.dataset.select);}
  const remove=e.target.closest('[data-remove]');if(remove&&!submitting&&!uploading&&!drafts.get(draftKey())?.pending){files.splice(Number(remove.dataset.remove),1);render();}
  const input=e.target.closest('[data-input]');if(input){try{const res=await api('/api/file?kind=input&task='+encodeURIComponent(input.dataset.input)+'&name='+encodeURIComponent(input.dataset.name));downloadBlob(await res.blob(),input.dataset.name);}catch(e){notice(e.message);}}
  const file=e.target.closest('[data-file]');if(file)await openPreview(file.dataset.task,file.dataset.file);
  const exp=e.target.closest('[data-export]');if(exp&&selected){try{const format=exp.dataset.export;downloadBlob(new Blob([conversationExport(state,selected,format)],{type:format==='json'?'application/json':'text/markdown'}),'agentmeld-'+selected+'.'+format);}catch(e){notice(e.message);}}

  if(e.target.closest('#sample')&&!submitting&&!uploading&&!drafts.get(draftKey())?.pending){
    const csv='month,product,revenue,cost\nJanuary,Studio,12000,5000\nJanuary,Team,18000,8000\nFebruary,Studio,15000,6000\nFebruary,Team,22000,9000\nMarch,Studio,14000,5800\nMarch,Team,29000,11000\n';
    files=[{name:'sample-sales.csv',data:btoa(csv)}];
    $('prompt').value='Analyze this sales CSV. Calculate total revenue and profit, compare products and monthly trends, and write a concise report.md with three useful recommendations. Include a summary.csv with your calculations.';
    render();$('prompt').focus();
  }
});
async function attachFiles(chosen){
  if(uploading||$('upload').disabled)return;
  rememberDraft();const key=draftKey(),draft=drafts.get(key);
  uploading=true;render();error();
  try{
    validateAttachments(draft.files,chosen);
    const added=[];
    for(const f of chosen){const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));added.push({name:f.name,data:btoa(binary)});}
    if(draft.pending)throw Error('Wait for this message to finish submitting before attaching files.');
    if(drafts.get(key)!==draft)throw Error('The original draft was cleared. Attach these files again in the new chat.');
    validateAttachments(draft.files,added);draft.files.push(...added);
    if(draftKey()===key)files=draft.files;
  }catch(e){notice(e.message);}finally{uploading=false;$('upload').value='';render();}
}
$('upload').onchange=()=>attachFiles([...$('upload').files]);
let dragDepth=0;
const fileDrag=e=>!!e.dataTransfer&&[...e.dataTransfer.types].includes('Files');
document.addEventListener('dragenter',e=>{if(fileDrag(e)){e.preventDefault();dragDepth++;if((view==='chat'||fileChatOpen)&&!$('upload').disabled)$('dropHint').hidden=false;}});
document.addEventListener('dragover',e=>{if(fileDrag(e)){e.preventDefault();e.dataTransfer.dropEffect=(view==='chat'||fileChatOpen)&&!$('upload').disabled?'copy':'none';}});
document.addEventListener('dragleave',e=>{if(fileDrag(e)){dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('dropHint').hidden=true;}});
document.addEventListener('drop',e=>{if(fileDrag(e)){e.preventDefault();dragDepth=0;$('dropHint').hidden=true;if((view==='chat'||fileChatOpen)&&!$('upload').disabled)attachFiles([...e.dataTransfer.files]);}});
window.addEventListener('blur',()=>{dragDepth=0;$('dropHint').hidden=true;});
$('composer').onsubmit=async e=>{
  e.preventDefault();error();const prompt=$('prompt').value.trim();if(!prompt||submitting||uploading||!connected||$('send').disabled)return;
  if(prompt==='/new'){$('prompt').value='';files=[];newTask();return;}
  rememberDraft();const key=draftKey(),draft=drafts.get(key);
  draft.pending??={prompt,files:[...files],conversationId:selected,requestKey:crypto.randomUUID()};
  const restoreFocus=document.activeElement===$('prompt')||document.activeElement===$('send');let sentConversation=null;
  submitting=true;render();
  try{
    const res=await api('/api/tasks',{method:'POST',body:JSON.stringify(draft.pending)});const task=await res.json();
    drafts.delete(key);
    if(draftKey()===key){selected=task.conversationId;sentConversation=selected;saveSelection();files=[];$('prompt').value='';}
    await refresh();
  }catch(e){if(e.status&&e.status<500){draft.pending=null;error(e.message);}else error(e.message+' Retry sends the same message once.');}
  finally{submitting=false;render();if(restoreFocus&&sentConversation===selected&&view==='chat'&&(document.activeElement===document.body||document.activeElement===$('send')||document.activeElement===$('prompt')))$('prompt').focus();}
};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&!composing&&e.keyCode!==229){e.preventDefault();$('composer').requestSubmit();}};
$('stop').onclick=async()=>{try{$('stop').disabled=true;await api('/api/stop',{method:'POST',body:JSON.stringify({taskId:$('stop').dataset.task})});await refresh();}catch(e){error(e.message);}finally{$('stop').disabled=false;}};
async function refresh(){
  if(refreshing)return;refreshing=true;let sessionExpired=false;
  try{state=await(await api('/api/state',{signal:AbortSignal.timeout(8000)})).json();connected=true;
    if(restoreSelection){restoreSelection=false;let saved;try{saved=sessionStorage.getItem('agentmeld-selection');}catch{}if(state.conversations.some(c=>c.id===saved)){selected=saved;showArchived=!!selectedChat()?.archived;}else saveSelection();}
  }catch(e){connected=false;sessionExpired=e.status===401;}finally{
    refreshing=false;$('connectionMessage').textContent=sessionExpired?'Local session expired. Reopen the current app link from the server to reconnect. Your saved work is preserved.':'Connection interrupted. Your saved work is preserved.';
    $('connectionStatus').textContent=connected?'Connected':sessionExpired?'Session expired':'Disconnected';$('connectionDot').classList.toggle('offline',!connected);$('retryConnection').hidden=connected;$('connectionBanner').hidden=connected;
    render();
  }
}
render();await refresh();setInterval(refresh,1000);
