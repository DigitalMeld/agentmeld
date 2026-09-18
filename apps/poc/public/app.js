import { installPreviewReader, textMetrics } from './preview-reader.js';
import { statusLabel, queueWait, countLabel, showTurnStatus, dayLabel, chatSearch, activityTasks, duration, elapsedLabel, runExport, renderMarkdown, literalMatches } from './conversation-tools.js';
import { artifactKey, latestVersions, textFile, csvRows, manifest, zipFiles } from './artifact-tools.js';
import { browseWorkspace, fileKind, breadcrumbs, readPreferences } from './file-browser.js';
import { chatInfo, orderedChats, outputEntries, visibleOutputs, conversationExport } from './organization.js';
import { formatBytes, validateAttachments } from './composer.js';
import { icon } from './icons.js';
import './tooltips.js';
const $=id=>document.getElementById(id);
let token=location.hash.slice(1)||sessionStorage.getItem('agentmeld-token')||'';
if(token){sessionStorage.setItem('agentmeld-token',token);history.replaceState(null,'',location.pathname);}
window.addEventListener('hashchange',()=>{if(location.hash.length>1){token=location.hash.slice(1);sessionStorage.setItem('agentmeld-token',token);history.replaceState(null,'',location.pathname);error();refresh();}});
let state={tasks:[],conversations:[],active:null},selected=null,files=[],view='chat',lastRender='';
let preferences;try{preferences=readPreferences(localStorage);}catch{preferences=readPreferences({getItem:()=>null});}
let fileCategory='all',fileLayout=preferences.layouts.all||'grid',fileSort=preferences.sort,fileChatOpen=false;
function saveFilePreferences(){try{localStorage.setItem('agentmeld-files',JSON.stringify(preferences));}catch{}}
function rememberOpened(taskId,name){const key=JSON.stringify([taskId,name]);delete preferences.opened[key];preferences.opened[key]=Date.now();preferences.opened=Object.fromEntries(Object.entries(preferences.opened).slice(-100));saveFilePreferences();}
let selecting=false,selectedArtifacts=new Set(),visibleArtifacts=[],bundleController=null,bundleProgress='',previewSequence=[];
let lastWorkspaceChoices='';
let workspaceSort='name',workspaceDescending=false,workspaceEntries=[];
try{$('showHiddenFiles').checked=localStorage.getItem('agentmeld-hidden-files')!=='false';}catch{}
let workspace=null,workspaceId='',workspacePath='',workspaceLoading=false,workspaceRequest=0;
const categories={all:'All artifacts',documents:'Documents',web:'Web artifacts',images:'Images',videos:'Videos',audio:'Podcasts',system:'System files'};
const categoryExtensions={documents:['md','txt','csv','json','pdf','docx'],web:['html','htm'],images:['png','jpg','jpeg','gif','webp','svg'],videos:['mp4','mov','webm'],audio:['mp3','wav','m4a','ogg']};
let restoreSelection=true,lastHistory='',showArchived=false;
function saveSelection(){try{if(selected)sessionStorage.setItem('agentmeld-selection',selected);else sessionStorage.removeItem('agentmeld-selection');}catch{}}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function formatted(text){return esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
const markdown=renderMarkdown;
let previewFocus=null;
let previewFile=null,previewRequest=0,connected=false,refreshing=false,uploading=false,composing=false;
let noticeTimer;
function notice(text){(document.querySelector('dialog[open]')||document.body).append($('notice'));$('notice').textContent=text;$('notice').classList.remove('sr');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('notice').classList.add('sr');},3500);}
const copyTimers=new WeakMap();
async function copyText(text,button){try{
 await navigator.clipboard.writeText(text);notice('Copied to clipboard.');
 if(button){clearTimeout(copyTimers.get(button));button.innerHTML=icon('check');button.classList.add('copied');copyTimers.set(button,setTimeout(()=>{button.innerHTML=icon('copy');button.classList.remove('copied');},1600));}
}catch{notice('Could not copy. Select the text and copy it manually.');}}
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
function selectConversation(id){closeConversationFind();document.querySelector('.history').classList.remove('open');rememberDraft();selected=id;showArchived=!!state.conversations.find(c=>c.id===id)?.archived;saveSelection();const d=drafts.get(draftKey());$('prompt').value=d?.text||'';files=d?.files||[];lastRender='';showChat();$('conversation').scrollTo({top:d?.scroll??$('conversation').scrollHeight,behavior:'instant'});updateLatest();error();}
function newTask(){closeConversationFind();rememberDraft();drafts.delete('new');selected=null;showArchived=false;saveSelection();files=[];$('prompt').value='';lastRender='';document.querySelector('.history').classList.remove('open');error();showChat();$('prompt').focus();}
$('chatSearch').oninput=()=>render();$('fileSearch').oninput=()=>render();$('archiveChats').onclick=()=>{showArchived=!showArchived;render();};$('activitySearch').oninput=()=>renderActivity();
$('attach').onclick=()=>$('upload').click();
$('newChat').onclick=newTask;$('mobileNew').onclick=newTask;
$('chatNav').onclick=()=>{showChat();if(matchMedia('(max-width:720px)').matches)document.querySelector('.history').classList.toggle('open');};$('filesNav').onclick=()=>{view='files';document.querySelector('.history').classList.remove('open');render();};
for(const button of document.querySelectorAll('[data-category]')){button.insertAdjacentHTML('afterbegin',icon(button.dataset.symbol));button.onclick=()=>{bundleController?.abort();$('selectionError').hidden=true;fileCategory=button.dataset.category;selectedArtifacts.clear();selecting=false;fileLayout=preferences.layouts[fileCategory]||(fileCategory==='documents'?'list':'grid');if(fileCategory==='system')loadWorkspace();$('fileSidebar').classList.remove('open');render();};}
$('fileOptions').addEventListener('keydown',e=>{if(!$('fileOptions').open||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...$('fileOptions').querySelectorAll('button')];let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[i].focus();});
function closeFileOptions(){$('fileOptions').open=false;$('fileOptions').querySelector('summary').focus();}
for(const button of document.querySelectorAll('[data-layout]'))button.onclick=()=>{fileLayout=button.dataset.layout;preferences.layouts[fileCategory]=fileLayout;saveFilePreferences();render();closeFileOptions();};
for(const button of document.querySelectorAll('[data-sort]'))button.onclick=()=>{fileSort=button.dataset.sort;preferences.sort=fileSort;saveFilePreferences();render();closeFileOptions();};
document.addEventListener('click',e=>{if(!$('fileOptions').contains(e.target))$('fileOptions').open=false;});
$('libraryMenu').onclick=()=>$('fileSidebar').classList.toggle('open');
$('libraryChat').onclick=()=>{fileChatOpen=!fileChatOpen;render();if(fileChatOpen)$('prompt').focus();};
$('fileChatClose').onclick=()=>{fileChatOpen=false;render();$('libraryChat').focus();};
$('fileChatNew').onclick=()=>{newTask();view='files';fileChatOpen=true;render();$('prompt').focus();};
function selectInspectorTab(name){for(const b of document.querySelectorAll('[data-inspector-tab]')){const active=b.dataset.inspectorTab===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;$(b.dataset.inspectorTab+'Panel').hidden=!active;}}
for(const b of document.querySelectorAll('[data-inspector-tab]')){b.onclick=()=>selectInspectorTab(b.dataset.inspectorTab);b.onkeydown=e=>{const tabs=[...document.querySelectorAll('[data-inspector-tab]')],i=tabs.indexOf(b);let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;else if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();selectInspectorTab(tabs[next].dataset.inspectorTab);tabs[next].focus();};}
$('clearActivitySearch').onclick=()=>{$('activitySearch').value='';renderActivity();$('activitySearch').focus();};
$('closeActivity').onclick=()=>{$('inspector').classList.remove('open');$('inspector').classList.add('closed');$('details').focus();};
$('details').onclick=()=>{const panel=$('inspector');if(matchMedia('(min-width:1001px)').matches)panel.classList.toggle('closed');else{panel.classList.remove('closed');panel.classList.toggle('open');}};
function fileButton(task,f){return '<button class="file" aria-label="Open '+esc(f.name)+'" data-tooltip data-task="'+task.id+'" data-file="'+esc(f.name)+'"><span class="fileIcon">'+icon('file')+'</span><span>'+esc(f.name)+'<small>'+formatBytes(f.size)+' · Open</small></span></button>';}
let detailId=null,lastDetail='';
$('closeRun').onclick=()=>$('runDetails').close();
function jumpToTask(task){selectConversation(task.conversationId);$('inspector').classList.remove('open');const turn=$('turn-'+task.id);turn?.focus({preventScroll:true});turn?.scrollIntoView({block:'start',behavior:'instant'});}
$('runConversation').onclick=()=>{const task=state.tasks.find(t=>t.id===detailId);$('runDetails').close();if(task)jumpToTask(task);};
function renderDetails(){
 const task=state.tasks.find(t=>t.id===detailId);if(!task)return;
 const title=state.conversations.find(c=>c.id===task.conversationId)?.title||'Conversation';
 const content='<div class="runFacts"><span class="statusBadge" data-status="'+esc(task.status)+'">'+esc(statusLabel(task.status))+'</span><span>Queue wait: '+elapsedLabel(queueWait(task))+'</span><span>'+countLabel(task.inputs.length,'input')+' · '+countLabel(task.artifacts.length,'output')+' · '+formatBytes(task.artifacts.reduce((n,f)=>n+f.size,0))+'</span></div><p class="muted">'+esc(title)+' · '+esc(new Date(task.createdAt).toLocaleString())+' · Duration: '+elapsedLabel(duration(task))+'</p><p class="runPrompt">'+esc(task.prompt)+'</p>'+((task.error||!['Finished','Completed','Done'].includes(task.activity))?'<p>'+esc(task.error||task.activity)+'</p>':'')+'<h3>Recorded milestones ('+(task.events||[]).length+')</h3>'+((task.events||[]).length?'<ol class="milestones">'+task.events.map((e,i)=>'<li><strong>'+esc(e.label)+'</strong><time>'+esc(new Date(e.at).toLocaleString())+(i?' · '+elapsedLabel(Date.parse(e.at)-Date.parse(task.events[i-1].at))+' since previous':'')+'</time></li>').join('')+'</ol>':'<p class="muted">Milestones were not recorded for this older turn.</p>')+'<p class="muted">These are run milestones, not a complete command history.</p>'+(task.inputs.length?'<h3>Inputs</h3>'+task.inputs.map(f=>'<button class="inputFile" data-input="'+task.id+'" data-name="'+esc(f.name)+'">'+esc(f.name)+' · '+formatBytes(f.size||0)+'</button>').join(''):'')+(task.artifacts.length?'<h3>Outputs</h3>'+task.artifacts.map(f=>fileButton(task,f)).join(''):'')+(task.answer?'<details class="runAnswer"><summary>Reply</summary>'+markdown(task.answer)+'</details>':'');
 if(content!==lastDetail){const expanded=$('runBody').querySelector('.runAnswer')?.open;$('runBody').innerHTML=content;if(expanded&&$('runBody').querySelector('.runAnswer'))$('runBody').querySelector('.runAnswer').open=true;lastDetail=content;}
 $('copyRunReply').disabled=!task.answer;$('copyMilestones').disabled=!task.events?.length;
 const tasks=currentActivity(),index=tasks.findIndex(t=>t.id===detailId);$('previousRun').disabled=index<=0;$('nextRun').disabled=index<0||index>=tasks.length-1;$('runPosition').textContent=index<0?'':(index+1)+' / '+tasks.length;
}
let lastActivity='',lastLibrary='',lastAlerts='';
function currentActivity(){return activityTasks(state,{query:$('activitySearch').value});}
function renderActivity(){
 let day='';const tasks=currentActivity();
 $('clearActivitySearch').hidden=!$('activitySearch').value;
 $('activityCount').textContent=$('activitySearch').value.trim()?countLabel(tasks.length,'matching run'):'';
 const alerts=state.tasks.filter(t=>['failed','interrupted'].includes(t.status));
 const alertContent=alerts.length?'<details class="runAlerts"><summary>'+countLabel(alerts.length,'run')+' need'+(alerts.length===1?'s':'')+' attention</summary>'+alerts.map(t=>'<button class="detailLink" data-detail="'+t.id+'">'+esc(t.prompt)+'<small>'+esc(t.error||statusLabel(t.status))+'</small></button>').join('')+'</details>':'';
 if(lastAlerts!==alertContent){const open=$('activityAlerts').querySelector('details')?.open;$('activityAlerts').innerHTML=alertContent;if(open&&$('activityAlerts').querySelector('details'))$('activityAlerts').querySelector('details').open=true;lastAlerts=alertContent;}
 const content=tasks.map(task=>{
 const date=new Date(task.createdAt),key=date.toLocaleDateString(),heading=key!==day?'<h3>'+esc(date.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}))+'</h3>':'';day=key;
 const title=state.conversations.find(c=>c.id===task.conversationId)?.title||'Conversation';
 return heading+'<article class="activityEntry"><button class="activityLink" data-jump="'+task.id+'" aria-label="Open conversation: '+esc(task.prompt)+'"><strong>'+esc(task.prompt)+'</strong><span class="activityMeta">'+'<span class="statusBadge" data-status="'+esc(task.status)+'">'+esc(statusLabel(task.status))+'</span> · '+esc(date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))+(duration(task)!==null?' · '+elapsedLabel(duration(task)):'')+'</span><span class="activityChat">'+esc(title)+'</span>'+((task.error||!['Finished','Completed','Done'].includes(task.activity))?'<span class="activitySummary">'+esc(task.error||task.activity)+'</span>':'')+'<span class="activityFileCount">'+countLabel(task.inputs.length,'input')+' · '+countLabel(task.artifacts.length,'output')+'</span></button><button class="detailLink" data-detail="'+task.id+'">View details</button>'+task.artifacts.map(f=>fileButton(task,f)).join('')+'</article>';
 }).join('')||'<p class="muted">'+(state.tasks.length?'No matching activity.':'No activity yet. Send a message to start.')+'</p>';
 if(content!==lastActivity){$('activity').innerHTML=content;lastActivity=content;}
}
function messageAction(attribute,id,label,symbol,extra=''){
 return '<button class="icon '+extra+'" '+attribute+'="'+id+'" aria-label="'+label+'" data-tooltip>'+icon(symbol)+'</button>';
}
function renderTurn(task,index,turns){
 const inputs=task.inputs.length?'<div class="messageLabel">'+task.inputs.map(f=>'<button class="inputFile" data-input="'+task.id+'" data-name="'+esc(f.name)+'" aria-label="Download original '+esc(f.name)+'">'+esc(f.name)+(Number.isFinite(f.size)?'<small>'+formatBytes(f.size)+'</small>':'')+'</button>').join(' ')+'</div>':'';
 const details=messageAction('data-detail',task.id,'Run details','activity');
 const request='<div class="messageRow requestRow"><div class="messageActions">'+messageAction('data-copy-request',task.id,'Copy request','copy')+'</div><div class="message user">'+esc(task.prompt)+inputs+'</div></div>';
 const reply=task.answer?'<div class="messageRow replyRow"><div class="message assistant">'+markdown(task.answer)+'</div><div class="messageActions">'+messageAction('data-copy-answer',task.id,'Copy reply','copy','copyReply')+details+'</div></div>':'';
 const active=['queued','running','cancelling'].includes(task.status);
 const status=showTurnStatus(task,index===turns.length-1)?'<div class="runStatus"'+(task.error||['failed','cancelled','interrupted'].includes(task.status)?' data-attention':'')+'><div class="pending">'+(active?'<span class="pulse"></span>':'')+esc(task.error||(task.status==='completed'&&!task.answer?'No reply recorded':task.activity))+'</div>'+(!task.answer?'<div class="messageActions">'+details+'</div>':'')+'</div>':'';
 const date=new Date(task.createdAt),previous=turns[index-1];
 const heading=!previous||new Date(previous.createdAt).toLocaleDateString()!==date.toLocaleDateString()?'<div class="daySeparator">'+esc(dayLabel(task.createdAt))+'</div>':'';
 return heading+'<div class="time"><time datetime="'+esc(task.createdAt)+'" title="'+esc(date.toLocaleString())+'">'+esc(date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))+'</time></div><div class="turn" id="turn-'+task.id+'" tabindex="-1">'+request+reply+status+task.artifacts.map(f=>fileButton(task,f)).join('')+'</div>';
}
function render(){
  const inFiles=view==='files',chatVisible=!inFiles||fileChatOpen;
  document.body.classList.toggle('filesView',inFiles);document.body.classList.toggle('fileChatOpen',inFiles&&fileChatOpen);
  document.querySelector('.history').hidden=inFiles;$('fileSidebar').hidden=!inFiles;document.querySelector('.top').hidden=inFiles;$('inspector').hidden=inFiles;
  $('chatSurface').hidden=!chatVisible;$('fileChatHeader').hidden=!inFiles;
  $('libraryChat').setAttribute('aria-pressed',String(fileChatOpen));$('libraryChat').setAttribute('aria-label',fileChatOpen?'Hide chat':'Show chat');
  $('libraryTitle').textContent=categories[fileCategory];$('workspaceTools').hidden=fileCategory!=='system';$('fileOptions').hidden=fileCategory==='system';
  for(const b of document.querySelectorAll('[data-category]')){b.classList.toggle('selected',b.dataset.category===fileCategory);b.setAttribute('aria-current',b.dataset.category===fileCategory?'page':'false');}
  for(const b of document.querySelectorAll('[data-sort]'))b.setAttribute('aria-pressed',String(b.dataset.sort===fileSort));
  for(const b of document.querySelectorAll('[data-layout]'))b.setAttribute('aria-pressed',String(b.dataset.layout===fileLayout));
  $('libraryFiles').className=fileCategory==='system'?'systemTable':fileLayout==='grid'?'artifactGrid':'artifactList';
  $('chatHeading').textContent=showArchived?'Archived':'Chats';
  $('archiveChats').setAttribute('aria-pressed',String(showArchived));
  $('archiveChats').setAttribute('aria-label',showArchived?'Show active chats':'Show archived chats');
  $('chatNav').classList.toggle('active',view==='chat');$('filesNav').classList.toggle('active',view==='files');
  $('conversation').hidden=!chatVisible;$('library').hidden=view!=='files';$('composeWrap').hidden=!chatVisible;
  const chatQuery=$('chatSearch').value.trim().toLocaleLowerCase();
  const matchingChats=orderedChats(state,showArchived,'').filter(c=>chatSearch(state,c,chatQuery)!==null);
  $('chatResults').textContent=chatQuery?countLabel(matchingChats.length,'matching chat'):'';$('clearChatSearch').hidden=!chatQuery;
  const historyContent=matchingChats.length?matchingChats.map(t=>'<button class="historyItem '+(t.id===selected?'selected':'')+'" data-select="'+t.id+'" aria-current="'+(t.id===selected?'true':'false')+'" aria-label="'+esc(t.title)+'" data-tooltip><span class="chatTitle">'+esc(t.title)+'</span><small>'+(t.pinned?'Pinned · ':'')+countLabel(chatInfo(state,t).count,'turn')+(chatInfo(state,t).status==='completed'?'':' · '+esc(chatInfo(state,t).status))+'</small>'+(chatQuery?'<span class="chatExcerpt">'+esc(chatSearch(state,t,chatQuery))+'</span>':'')+'</button>').join(''):'<div class="emptyHistory">'+(chatQuery?'No matching chats.':showArchived?'No archived chats.':'Your chats will appear here.')+'</div>';
  if(historyContent!==lastHistory){$('history').innerHTML=historyContent;lastHistory=historyContent;}
  const current=state.conversations.find(c=>c.id===selected);
  $('chatToolbar').hidden=!current||!chatVisible;$('selectedTitle').textContent=current?.title||'';$('selectedTitle').title=current?.title||'';
  $('chatSummary').textContent=current?countLabel(chatInfo(state,current).count,'turn'):'';
  $('readOnlyBanner').hidden=!current||!chatVisible||(!current.archived&&current.continuation==='ready');
  $('readOnlyReason').textContent=current?.archived?'This chat is archived.':current?.continuation==='legacy'?'This older chat is read-only. Its history and files are preserved.':'This chat cannot safely resume. Its history and files are preserved.';
  $('restoreChat').hidden=!current?.archived;
  const turns=state.tasks.filter(t=>t.conversationId===selected);
  const task=turns.at(-1);
  const content=turns.length?turns.map(renderTurn).join(''):'<div class="welcome"><span class="avatar large"><img src="/brain.svg" alt="" aria-hidden="true"></span><h1>What would you like to get done?</h1><p>Bring a file and a question.<br>I’ll do the work and bring back the result.</p><button class="suggestion" id="sample">Find the story in my sales data<small>Try a sample CSV and get a real report ↗</small></button></div>';
  if(content!==lastRender){const nearBottom=$('conversation').scrollHeight-$('conversation').scrollTop-$('conversation').clientHeight<100; $('conversation').innerHTML=content;lastRender=content;highlightConversation();if(nearBottom)$('conversation').scrollTop=$('conversation').scrollHeight;}
  renderActivity();if($('runDetails').open)renderDetails();
  $('taskFiles').innerHTML=task?.artifacts.length?task.artifacts.map(f=>fileButton(task,f)).join(''):'Finished files will appear here.';
  const fileQuery=$('fileSearch').value.trim().toLocaleLowerCase();
  let outputs=visibleOutputs(state,fileQuery,'all',fileSort).filter(e=>!categoryExtensions[fileCategory]||categoryExtensions[fileCategory].includes(e.file.name.split('.').pop().toLowerCase()));
  if(fileSort==='opened')outputs.sort((a,b)=>(preferences.opened[JSON.stringify([b.task.id,b.file.name])]||0)-(preferences.opened[JSON.stringify([a.task.id,a.file.name])]||0));
  if($('latestVersions').checked){const keys=new Set(latestVersions(outputEntries(state)).map(artifactKey));outputs=outputs.filter(e=>keys.has(artifactKey(e)));}
  visibleArtifacts=outputs;renderArtifactActions();
  $('fileSummary').textContent=countLabel(outputs.length,'output')+' · '+formatBytes(outputs.reduce((sum,e)=>sum+e.file.size,0));
  const libraryContent=fileCategory==='system'?workspaceMarkup(fileQuery):outputs.map(({task:t,file:f,title,version})=>'<article class="libraryEntry'+(selectedArtifacts.has(JSON.stringify([t.id,f.name]))?' isSelected':'')+'">'+(selecting?'<label class="artifactCheck"><input type="checkbox" data-artifact-key="'+esc(JSON.stringify([t.id,f.name]))+'" '+(selectedArtifacts.has(JSON.stringify([t.id,f.name]))?'checked':'')+(bundleController?' disabled':'')+' aria-label="Select '+esc(f.name)+'"></label>':'')+'<button class="artifactThumbnail" data-task="'+t.id+'" data-file="'+esc(f.name)+'" aria-label="Preview '+esc(f.name)+'"><span class="thumbnailText" data-thumbnail-task="'+t.id+'" data-thumbnail-name="'+esc(f.name)+'">'+esc(f.name)+'</span></button>'+fileButton(t,f)+'<button class="outputOrigin" data-jump="'+t.id+'">'+esc(title)+' · Version '+version+' · '+esc(new Date(t.createdAt).toLocaleString())+'</button></article>').join('')||'<div class="libraryEmpty"><h2>'+(fileQuery?'No matching files':'No '+(fileCategory==='all'?'artifacts':categories[fileCategory].toLowerCase())+' yet')+'</h2><p>Files you create in this category will appear here.</p></div>';
  if(libraryContent!==lastLibrary){$('libraryFiles').innerHTML=libraryContent;lastLibrary=libraryContent;}
  if(inFiles&&fileCategory!=='system')loadThumbnails();
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

function updateWorkspaceChoices(){
  const choices=state.conversations.map(c=>'<button data-workspace-id="'+esc(c.id)+'">'+esc(c.title)+'</button>').join('');
  if(lastWorkspaceChoices!==choices){$('workspaceSelect').innerHTML=choices;lastWorkspaceChoices=choices;}
  if(!state.conversations.some(c=>c.id===workspaceId))workspaceId=selected||state.conversations[0]?.id||'';
  $('workspaceLabel').textContent=state.conversations.find(c=>c.id===workspaceId)?.title||'Choose workspace';
}
async function loadWorkspace(){
  updateWorkspaceChoices();const id=workspaceId,request=++workspaceRequest;
  if(!id){workspace=null;workspaceLoading=false;render();return;}
  workspaceLoading=true;$('workspaceError').hidden=true;render();
  try{const next=await(await api('/api/workspace?conversation='+encodeURIComponent(id),{signal:AbortSignal.timeout(8000)})).json();if(request!==workspaceRequest)return;workspace=next;
    if(workspacePath&&!next.entries.some(e=>e.directory&&e.name===workspacePath))workspacePath='';
  }catch(e){if(request===workspaceRequest){workspace=null;$('workspaceError').textContent='Could not load this workspace. Use Refresh to retry.';$('workspaceError').hidden=false;}}
  finally{if(request===workspaceRequest){workspaceLoading=false;render();}}
}
function workspaceMarkup(query){
  updateWorkspaceChoices();$('workspaceRefresh').disabled=workspaceLoading;
  $('workspaceStatus').textContent=workspaceLoading?'Loading workspace…':!workspaceId?'No conversations yet.':workspace?((workspace.working?'Work is running. Showing the last saved snapshot. ':workspace.continuation==='legacy'?'This older conversation has no workspace snapshot. ':'All saved files in /workspace. ')+(workspace.capturedAt?'Saved '+new Date(workspace.capturedAt).toLocaleString():'')):'Choose a workspace or refresh to load its files.';
  $('workspaceUp').disabled=!workspacePath;
  const breadcrumbContent=breadcrumbs(workspacePath).map(b=>'<button data-folder="'+esc(b.path)+'">'+esc(b.name)+'</button>').join('<span aria-hidden="true"> / </span>');
  if($('workspaceBreadcrumbs').innerHTML!==breadcrumbContent)$('workspaceBreadcrumbs').innerHTML=breadcrumbContent;
  const entries=workspace?.conversationId===workspaceId?browseWorkspace(workspace.entries,workspacePath,query,$('showHiddenFiles').checked,workspaceSort,workspaceDescending):[];workspaceEntries=entries;
  $('fileSummary').textContent=countLabel(entries.filter(e=>e.directory).length,'folder')+' · '+countLabel(entries.filter(e=>!e.directory).length,'file')+(query?' matching in /workspace'+(workspacePath?'/'+workspacePath:''):'')+' · '+formatBytes(entries.reduce((sum,e)=>sum+(e.size||0),0));
  return '<table><thead><tr>'+[['name','Name'],['type','Type'],['modified','Last modified'],['size','Size']].map(([key,label])=>'<th aria-sort="'+(workspaceSort===key?(workspaceDescending?'descending':'ascending'):'none')+'"><button data-workspace-sort="'+key+'">'+label+(workspaceSort===key?(workspaceDescending?' ↓':' ↑'):'')+'</button></th>').join('')+'</tr></thead><tbody>'+entries.map(e=>'<tr><td><button class="file" '+(e.directory?'data-folder="'+esc(e.name)+'"':'data-workspace-file="'+esc(e.name)+'"')+'><span class="fileIcon">'+icon(e.directory?'folder':'file')+'</span><span>'+esc(query?e.name:e.name.split('/').pop())+'</span></button></td><td>'+(e.directory?'Folder':esc(fileKind(e.name)))+'</td><td>'+(e.modifiedAt?esc(new Date(e.modifiedAt).toLocaleString()):'—')+'</td><td>'+(e.directory?'—':formatBytes(e.size))+'</td></tr>').join('')+'</tbody></table>'+(entries.length||workspaceLoading?'':'<p class="muted">'+(query?'No matching files.':'This folder is empty.')+'</p>');
}
document.addEventListener('click',e=>{const choice=e.target.closest('[data-workspace-id]');if(choice){workspaceId=choice.dataset.workspaceId;workspacePath='';workspace=null;$('fileSearch').value='';$('workspacePicker').open=false;loadWorkspace();$('workspacePicker').querySelector('summary').focus();}else if(!$('workspacePicker').contains(e.target))$('workspacePicker').open=false;});
$('workspaceRefresh').onclick=loadWorkspace;
$('showHiddenFiles').onchange=()=>{try{localStorage.setItem('agentmeld-hidden-files',String($('showHiddenFiles').checked));}catch{}render();};
$('workspaceUp').onclick=()=>{workspacePath=workspacePath.split('/').slice(0,-1).join('/');$('fileSearch').value='';render();};
$('copyWorkspacePath').onclick=()=>copyText('/workspace'+(workspacePath?'/'+workspacePath:''));
$('workspaceConversation').onclick=()=>{if(workspaceId)selectConversation(workspaceId);};
$('copyFilePath').onclick=()=>{if(previewFile)copyText('/workspace/'+previewFile.name);};
async function openWorkspaceFile(name){
  const id=workspaceId,request=++previewRequest;beginPreview(name);
  try{const blob=await(await api('/api/workspace/file?conversation='+encodeURIComponent(id)+'&name='+encodeURIComponent(name),{signal:AbortSignal.timeout(8000)})).blob();
    const text=textFile(name)?await blob.text():undefined;
    if(request!==previewRequest)return;
    clearPreviewImage();previewFile={blob,name,text,conversationId:id};previewRaw=false;$('previewTitle').textContent=name;$('previewOrigin').textContent=(state.conversations.find(c=>c.id===id)?.title||'Workspace')+' · /workspace/'+name+' · '+formatBytes(blob.size);$('versionLabel').hidden=true;$('copyPreview').hidden=text===undefined;renderPreviewText();if(!$('preview').open)$('preview').showModal();
  }catch(e){if(request===previewRequest)failPreview('Could not open this workspace file. Close and refresh the workspace to retry.');}
}

function setPreviewBusy(busy){$('preview').setAttribute('aria-busy',String(busy));for(const id of ['downloadFile','copyFilePath','copyFilename','copyPreview','previewConversation','findInPreview','wrapPreview','previewSource','previewVersion','previousFile','nextFile'])$(id).disabled=busy;if(!busy)updatePreviewNavigation();}
function beginPreview(name){previewFocus=$('preview').contains(document.activeElement)?document.activeElement:null;clearPreviewImage();previewReader.reset();previewFile=null;$('previewTitle').textContent=name;$('previewTitle').title=name;$('previewOrigin').textContent='';$('previewMetadata').textContent='Loading…';$('previewPosition').textContent='';$('previewWarning').hidden=true;$('previewBody').textContent='Loading file…';$('versionLabel').hidden=true;$('previewSource').hidden=true;setPreviewBusy(true);if(!$('preview').open)$('preview').showModal();}
function failPreview(message){$('preview').setAttribute('aria-busy','false');$('previewMetadata').textContent='';$('previewBody').textContent=message;}
$('workspacePicker').addEventListener('keydown',e=>{if(!$('workspacePicker').open||!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const choices=[...$('workspaceSelect').querySelectorAll('button')];if(!choices.length)return;let i=choices.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?choices.length-1:(i+(e.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[i].focus();});
document.addEventListener('click',e=>{const sort=e.target.closest('[data-workspace-sort]');if(sort){const key=sort.dataset.workspaceSort;workspaceDescending=workspaceSort===key?!workspaceDescending:false;workspaceSort=key;render();document.querySelector('[data-workspace-sort="'+key+'"]').focus();}});

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
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'&&selected&&(view==='chat'||fileChatOpen)){e.preventDefault();openConversationFind();}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(view==='files'){$('fileSidebar').classList.add('open');$('fileSearch').focus();}else{document.querySelector('.history').classList.add('open');$('chatSearch').focus();}}
  if(e.key==='Escape'){if(!$('conversationFind').hidden){closeConversationFind();$('findInChat').focus();}else if($('workspacePicker').open){$('workspacePicker').open=false;$('workspacePicker').querySelector('summary').focus();}else if($('fileOptions').open){closeFileOptions();}else if($('fileSidebar').classList.contains('open')){$('fileSidebar').classList.remove('open');$('libraryMenu').focus();}else if(view==='files'&&fileChatOpen){$('fileChatClose').click();}else if(document.querySelector('.history').classList.contains('open')){document.querySelector('.history').classList.remove('open');$('chatNav').focus();}else if($('inspector').classList.contains('open'))$('closeActivity').click();}
});
window.addEventListener('beforeunload',e=>{if($('prompt').value||files.length||[...drafts.entries()].some(([key,d])=>d.pending||(key!==draftKey()&&(d.text||d.files?.length)))){e.preventDefault();e.returnValue='';}});
function updateLatest(){$('latestBar').hidden=(view!=='chat'&&!fileChatOpen)||!selected||$('conversation').scrollHeight-$('conversation').scrollTop-$('conversation').clientHeight<150;}
$('conversation').addEventListener('scroll',updateLatest);
$('jumpLatest').onclick=()=>{$('conversation').scrollTo({top:$('conversation').scrollHeight,behavior:'instant'});updateLatest();$('prompt').focus({preventScroll:true});};
let previewImageUrl=null;function clearPreviewImage(){for(const media of $('previewBody').querySelectorAll('audio,video')){media.onerror=null;media.pause();media.removeAttribute('src');media.load();}if(previewImageUrl)URL.revokeObjectURL(previewImageUrl);previewImageUrl=null;}
$('preview').addEventListener('close',()=>{previewRequest++;previewReader.reset();clearPreviewImage();$('preview').classList.remove('expanded');$('expandPreview').setAttribute('aria-pressed','false');$('expandPreview').textContent='Expand';});
const previewReader=installPreviewReader({getFile:()=>previewFile,copy:copyText});
function renderPreviewText(){renderPreviewContent();previewReader.refresh();setPreviewBusy(false);if(previewFocus&&document.activeElement===document.body)(previewFocus.disabled?$('previewBody'):previewFocus).focus({preventScroll:true});}
function renderPreviewContent(){
 if(!previewFile)return;clearPreviewImage();updatePreviewNavigation();
 $('previewWarning').hidden=true;
 const {name,blob,text}=previewFile,ext=name.split('.').pop().toLowerCase(),metrics=text!==undefined?textMetrics(text):null;
 $('previewMetadata').textContent=fileKind(name)+' · '+formatBytes(blob.size)+(text!==undefined?' · '+countLabel(metrics.lines,'line')+' · '+countLabel(metrics.words,'word')+' · '+countLabel(metrics.characters,'character'):'');
 const structured=['md','json','csv'].includes(ext)&&text!==undefined;
 $('previewSource').hidden=!structured;$('previewSource').textContent=previewRaw?'View formatted '+ext.toUpperCase():'View raw '+ext.toUpperCase();
 const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime'};
 if(types[ext]){const type=types[ext],tag=type.startsWith('image')?'img':type.startsWith('audio')?'audio':'video';previewImageUrl=URL.createObjectURL(new Blob([blob],{type}));const el=document.createElement(tag);el.src=previewImageUrl;el.className='fileMedia';el.setAttribute('aria-label',name);if(tag==='img'){el.alt=name;el.classList.add('fileImage');el.onload=()=>{$('previewMetadata').textContent+=' · '+el.naturalWidth+' × '+el.naturalHeight;};}else{el.controls=true;el.preload='metadata';}el.onerror=()=>{const msg=document.createElement('p');msg.textContent='This format could not be previewed. You can still download the original file.';$('previewBody').replaceChildren(msg);};$('previewBody').replaceChildren(el);return;}
 if(text===undefined){$('previewBody').textContent='Preview is unavailable for this format. Download the original file to open it.';return;}
 if(text===''){$('previewBody').innerHTML='<p class="previewHint muted">This file is empty.</p>';return;}
 if(!previewRaw&&ext==='csv'){const rows=csvRows(text);$('previewBody').innerHTML='<div class="tableWrap"><table class="csvPreview">'+rows.map((r,i)=>'<tr>'+r.slice(0,50).map(c=>'<'+(i?'td':'th')+'>'+esc(c)+'</'+(i?'td':'th')+'>').join('')+'</tr>').join('')+'</table></div><p class="muted previewHint">Preview shows up to 100 data rows and 50 columns. Download preserves the complete file.</p>';return;}
 let content=text;if(!previewRaw&&ext==='json'){try{content=JSON.stringify(JSON.parse(text),null,2);}catch{content=text;$('previewWarning').textContent='Invalid JSON. Showing the original text.';$('previewWarning').hidden=false;}}
 $('previewBody').innerHTML=ext==='md'&&!previewRaw?markdown(text):'<pre>'+esc(content)+'</pre>';
}
$('previewSource').onclick=()=>{previewRaw=!previewRaw;renderPreviewText();};
$('previewConversation').onclick=()=>{if(previewFile?.conversationId){$('preview').close();selectConversation(previewFile.conversationId);return;}const task=state.tasks.find(t=>t.id===previewFile?.taskId);$('preview').close();if(task)jumpToTask(task);};
$('previewVersion').onchange=()=>{if(previewFile){const next=$('previewVersion').value;$('previewVersion').value=previewFile.taskId;openPreview(next,previewFile.name);}};
async function openPreview(taskId,name){
  const request=++previewRequest;beginPreview(name);
  try{
    const res=await api('/api/file?task='+encodeURIComponent(taskId)+'&name='+encodeURIComponent(name),{signal:AbortSignal.timeout(8000)});const blob=await res.blob();
    const isText=textFile(name);const text=isText?await blob.text():undefined;
    if(request!==previewRequest)return;
    clearPreviewImage();rememberOpened(taskId,name);previewFile={blob,name,text,taskId};previewRaw=false;$('previewTitle').textContent=name;
    const task=state.tasks.find(t=>t.id===taskId);
    $('previewOrigin').textContent=(state.conversations.find(c=>c.id===task?.conversationId)?.title||'Conversation')+' · '+(task?new Date(task.createdAt).toLocaleString():'')+' · '+formatBytes(blob.size);
    const versions=outputEntries(state).filter(e=>e.task.conversationId===task?.conversationId&&e.file.name===name);
    $('versionLabel').hidden=versions.length<2;
    $('previewVersion').innerHTML=versions.map(e=>'<option value="'+e.task.id+'">Version '+e.version+' · '+esc(new Date(e.task.createdAt).toLocaleString())+'</option>').join('');$('previewVersion').value=taskId;
    $('copyPreview').hidden=!isText;renderPreviewText();
    if(!$('preview').open)$('preview').showModal();
  }catch(e){if(request===previewRequest)failPreview('Could not load this file. Close and open it again to retry.');}
}

document.addEventListener('click',async e=>{
  const folder=e.target.closest('[data-folder]');if(folder){workspacePath=folder.dataset.folder;$('fileSearch').value='';render();}
  const workspaceFile=e.target.closest('[data-workspace-file]');if(workspaceFile){previewSequence=workspaceEntries.filter(e=>!e.directory).map(e=>({conversationId:workspaceId,name:e.name}));await openWorkspaceFile(workspaceFile.dataset.workspaceFile);}
  const copy=e.target.closest('[data-copy-answer]');if(copy){const task=state.tasks.find(t=>t.id===copy.dataset.copyAnswer);if(task)await copyText(task.answer,copy);}
  const jump=e.target.closest('[data-jump]');if(jump){const task=state.tasks.find(t=>t.id===jump.dataset.jump);if(task){jumpToTask(task);}}
  const detail=e.target.closest('[data-detail]');if(detail){detailId=detail.dataset.detail;renderDetails();$('runDetails').showModal();}
  const choose=e.target.closest('[data-select]');if(choose){selectConversation(choose.dataset.select);}
  const remove=e.target.closest('[data-remove]');if(remove&&!submitting&&!uploading&&!drafts.get(draftKey())?.pending){files.splice(Number(remove.dataset.remove),1);render();}
  const input=e.target.closest('[data-input]');if(input){try{const res=await api('/api/file?kind=input&task='+encodeURIComponent(input.dataset.input)+'&name='+encodeURIComponent(input.dataset.name));downloadBlob(await res.blob(),input.dataset.name);}catch(e){notice(e.message);}}
  const file=e.target.closest('[data-file]');if(file){previewSequence=(file.closest('#libraryFiles')?visibleArtifacts:outputEntries(state).filter(x=>x.task.conversationId===state.tasks.find(t=>t.id===file.dataset.task)?.conversationId)).map(x=>({taskId:x.task.id,name:x.file.name}));await openPreview(file.dataset.task,file.dataset.file);}
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

function renderArtifactActions(){
 const system=fileCategory==='system';$('selectArtifacts').hidden=system;$('artifactFilters').hidden=system;$('selectArtifacts').textContent=selecting?'Done':'Select';$('selectArtifacts').setAttribute('aria-pressed',String(selecting));$('selectionBar').hidden=!selecting||system;$('clearFileSearch').hidden=!$('fileSearch').value;
 const all=outputEntries(state),keys=new Set(all.map(artifactKey));selectedArtifacts=new Set([...selectedArtifacts].filter(k=>keys.has(k)));
 $('selectArtifacts').disabled=!!bundleController;for(const checkbox of document.querySelectorAll('[data-artifact-key]'))checkbox.disabled=!!bundleController;
 const chosen=all.filter(e=>selectedArtifacts.has(artifactKey(e)));$('selectionSummary').textContent=bundleController?bundleProgress:chosen.length+' selected · '+formatBytes(chosen.reduce((n,e)=>n+e.file.size,0));
 for(const id of ['downloadSelected','exportManifest','copySelectedPaths','clearSelection'])$(id).disabled=!chosen.length||!!bundleController;
 $('selectVisible').disabled=!visibleArtifacts.length||!!bundleController;$('cancelDownload').hidden=!bundleController;
 for(const b of document.querySelectorAll('[data-category]')){if(b.dataset.category==='system')continue;let count=b.querySelector('.categoryCount');if(!count){count=document.createElement('span');count.className='categoryCount';count.setAttribute('aria-hidden','true');b.append(count);}count.textContent=all.filter(e=>!categoryExtensions[b.dataset.category]||categoryExtensions[b.dataset.category].includes(e.file.name.split('.').pop().toLowerCase())).length;}
}
$('selectArtifacts').onclick=()=>{$('selectionError').hidden=true;selecting=!selecting;if(!selecting)selectedArtifacts.clear();render();};
$('selectVisible').onclick=()=>{for(const e of visibleArtifacts)selectedArtifacts.add(artifactKey(e));render();};
$('clearSelection').onclick=()=>{selectedArtifacts.clear();render();};
$('latestVersions').onchange=()=>{selectedArtifacts.clear();render();};
$('clearFileSearch').onclick=()=>{$('fileSearch').value='';render();$('fileSearch').focus();};
document.addEventListener('change',e=>{if(e.target.matches('[data-artifact-key]')){const key=e.target.dataset.artifactKey;e.target.checked?selectedArtifacts.add(key):selectedArtifacts.delete(key);e.target.closest('.libraryEntry').classList.toggle('isSelected',e.target.checked);renderArtifactActions();}});
const chosenArtifacts=()=>outputEntries(state).filter(e=>selectedArtifacts.has(artifactKey(e)));
$('copySelectedPaths').onclick=()=>copyText(chosenArtifacts().map(e=>'/workspace/'+e.file.name+' (turn '+e.task.id+')').join('\n'));
$('exportManifest').onclick=()=>downloadBlob(new Blob([JSON.stringify(manifest(chosenArtifacts()),null,2)],{type:'application/json'}),'artifact-index.json');
$('cancelDownload').onclick=()=>bundleController?.abort();
$('downloadSelected').onclick=async()=>{
 const chosen=chosenArtifacts();if(bundleController||!chosen.length)return;
 if(chosen.length>500||chosen.reduce((n,e)=>n+e.file.size,0)>33500000){$('selectionError').textContent='Select at most 500 files totaling less than 32 MB.';$('selectionError').hidden=false;return;}
 bundleProgress='Preparing archive…';bundleController=new AbortController();const controller=bundleController;$('selectionError').hidden=true;renderArtifactActions();
 try{const entries=[];for(const [i,e] of chosen.entries()){bundleProgress='Preparing '+(i+1)+' of '+chosen.length+'…';$('selectionSummary').textContent=bundleProgress;const res=await api('/api/file?task='+encodeURIComponent(e.task.id)+'&name='+encodeURIComponent(e.file.name),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});entries.push({name:e.task.id+'/'+e.file.name,data:new Uint8Array(await res.arrayBuffer())});}controller.signal.throwIfAborted();entries.push({name:'artifact-index.json',data:new TextEncoder().encode(JSON.stringify(manifest(chosen),null,2))});downloadBlob(zipFiles(entries),'agentmeld-artifacts.zip');notice('Archive ready.');}
 catch(e){$('selectionError').textContent=controller.signal.aborted?'Download cancelled. Your selection is preserved.':'Could not prepare the archive. Retry to download your selection.';$('selectionError').hidden=false;}
 finally{bundleController=null;renderArtifactActions();}
};
function updatePreviewNavigation(){const i=previewSequence.findIndex(e=>e.taskId===previewFile?.taskId&&e.conversationId===previewFile?.conversationId&&e.name===previewFile?.name);$('previousFile').disabled=i<=0;$('nextFile').disabled=i<0||i>=previewSequence.length-1;$('previewPosition').textContent=i<0?'':(i+1)+' / '+previewSequence.length;}
function adjacentPreview(delta){if($('preview').getAttribute('aria-busy')==='true')return;const i=previewSequence.findIndex(e=>e.taskId===previewFile?.taskId&&e.conversationId===previewFile?.conversationId&&e.name===previewFile?.name);const next=i<0?null:previewSequence[i+delta];if(next){if(next.conversationId)openWorkspaceFile(next.name);else openPreview(next.taskId,next.name);}}
$('previousFile').onclick=()=>adjacentPreview(-1);$('nextFile').onclick=()=>adjacentPreview(1);
$('expandPreview').onclick=()=>{const expanded=$('preview').classList.toggle('expanded');$('expandPreview').setAttribute('aria-pressed',String(expanded));$('expandPreview').textContent=expanded?'Restore size':'Expand';};
$('preview').addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select,audio,video')||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();adjacentPreview(e.key==='ArrowLeft'?-1:1);}});

let findMarks=[],findIndex=-1;
function openConversationFind(){$('conversationFind').hidden=false;$('findText').focus();}
function closeConversationFind(){$('conversationFind').hidden=true;$('findText').value='';highlightConversation();}
function highlightConversation(){
 const container=$('conversation');for(const mark of container.querySelectorAll('mark.searchMatch'))mark.replaceWith(document.createTextNode(mark.textContent));container.normalize();findMarks=[];
 const q=$('findText').value.trim().toLocaleLowerCase();if(q){for(const message of container.querySelectorAll('.message')){const walker=document.createTreeWalker(message,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('button'))nodes.push(walker.currentNode);for(const node of nodes){const text=node.textContent,matches=literalMatches(text,$('findText').value);let start=0,fragment=document.createDocumentFragment();if(!matches.length)continue;for(const {index,length} of matches){fragment.append(document.createTextNode(text.slice(start,index)));const mark=document.createElement('mark');mark.className='searchMatch';mark.textContent=text.slice(index,index+length);fragment.append(mark);findMarks.push(mark);start=index+length;}fragment.append(document.createTextNode(text.slice(start)));node.replaceWith(fragment);}}}
 findIndex=Math.min(Math.max(findIndex,0),findMarks.length-1);updateFind(false);
}
function updateFind(scroll){findMarks.forEach((m,i)=>m.classList.toggle('currentMatch',i===findIndex));$('findCount').textContent=findMarks.length?(findIndex+1)+' / '+findMarks.length:($('findText').value?'No matches':'');$('findPrevious').disabled=$('findNext').disabled=!findMarks.length;if(scroll)findMarks[findIndex]?.scrollIntoView({block:'center',behavior:'instant'});}
function moveFind(delta){if(findMarks.length){findIndex=(findIndex+delta+findMarks.length)%findMarks.length;updateFind(true);}}
$('findInChat').onclick=openConversationFind;$('closeFind').onclick=()=>{closeConversationFind();$('findInChat').focus();};$('findText').oninput=()=>{findIndex=0;highlightConversation();updateFind(true);};$('findPrevious').onclick=()=>moveFind(-1);$('findNext').onclick=()=>moveFind(1);$('findText').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();moveFind(e.shiftKey?-1:1);}};
$('clearChatSearch').onclick=()=>{$('chatSearch').value='';render();$('chatSearch').focus();};
document.addEventListener('click',async e=>{
 const copy=e.target.closest('[data-copy-request]');if(copy){const t=state.tasks.find(t=>t.id===copy.dataset.copyRequest);if(t)await copyText(t.prompt,copy);}
 const code=e.target.closest('.copyCode');if(code)await copyText(code.closest('.codeBlock').querySelector('code').textContent);
});
const selectedRun=()=>state.tasks.find(t=>t.id===detailId);
$('exportRun').onclick=()=>{const t=selectedRun();if(t)downloadBlob(new Blob([JSON.stringify(runExport(t,state.conversations.find(c=>c.id===t.conversationId)?.title||'Conversation'),null,2)],{type:'application/json'}),'run-'+t.id+'.json');};
$('copyRun').onclick=()=>{const t=selectedRun();if(t)copyText(t.prompt+'\n'+t.status+' · '+(t.error||t.activity)+'\nDuration: '+elapsedLabel(duration(t)));};
function moveRun(delta){const list=currentActivity(),index=list.findIndex(t=>t.id===detailId);if(index>=0&&list[index+delta]){detailId=list[index+delta].id;renderDetails();$('runBody').scrollTop=0;if(document.activeElement===document.body)$('runBody').focus({preventScroll:true});}}
$('copyRunRequest').onclick=()=>{const t=selectedRun();if(t)copyText(t.prompt);};
$('copyRunReply').onclick=()=>{const t=selectedRun();if(t?.answer)copyText(t.answer);};
$('copyMilestones').onclick=()=>{const t=selectedRun();if(t)copyText((t.events||[]).map(e=>e.at+' · '+e.label).join('\n'));};
$('runDetails').addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select')||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();moveRun(e.key==='ArrowLeft'?-1:1);}});
$('previousRun').onclick=()=>moveRun(-1);$('nextRun').onclick=()=>moveRun(1);
render();await refresh();setInterval(refresh,1000);
