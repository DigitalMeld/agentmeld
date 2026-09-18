// Search only rendered text. Never execute document content or alter download bytes.
export function textMetrics(text){return {lines:text?text.split(/\r\n|\r|\n/).length:0,words:(text.match(/\S+/gu)||[]).length,characters:[...text].length};}
export function installPreviewReader({getFile,copy}){
 const $=id=>document.getElementById(id),body=$('previewBody');let marks=[],index=-1;
 let wrap=true;try{wrap=localStorage.getItem('agentmeld-preview-wrap')!=='false';}catch{}
 function update(scroll=false){marks.forEach((m,i)=>m.classList.toggle('currentMatch',i===index));$('previewMatchCount').textContent=marks.length?(index+1)+' / '+marks.length+(marks.length===500?' (limit)':''):($('previewFindText').value?'No matches':'');$('previewFindPrevious').disabled=$('previewFindNext').disabled=!marks.length;if(scroll)marks[index]?.scrollIntoView({block:'center',behavior:'instant'});}
 function search(scroll=false){
  for(const mark of body.querySelectorAll('mark.previewMatch'))mark.replaceWith(document.createTextNode(mark.textContent));body.normalize();marks=[];
  const query=$('previewFindText').value.trim();if(query){const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped,'giu');const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('button,.previewHint'))nodes.push(walker.currentNode);
   for(const node of nodes){if(marks.length>=500)break;let last=0;const fragment=document.createDocumentFragment();for(const match of node.textContent.matchAll(pattern)){if(marks.length>=500)break;fragment.append(document.createTextNode(node.textContent.slice(last,match.index)));const mark=document.createElement('mark');mark.className='previewMatch searchMatch';mark.textContent=match[0];fragment.append(mark);marks.push(mark);last=match.index+match[0].length;}if(last){fragment.append(document.createTextNode(node.textContent.slice(last)));node.replaceWith(fragment);}}
  }index=marks.length?0:-1;update(scroll);
 }
 function close(){ $('previewFind').hidden=true;$('previewFindText').value='';search(); }
 function open(){if($('findInPreview').hidden||$('findInPreview').disabled)return;$('previewFind').hidden=false;$('previewFindText').focus();}
 function move(delta){if(marks.length){index=(index+delta+marks.length)%marks.length;update(true);}}
 function applyWrap(){body.classList.toggle('noWrap',!wrap);$('wrapPreview').setAttribute('aria-pressed',String(wrap));}
 $('findInPreview').onclick=open;$('closePreviewFind').onclick=()=>{close();$('findInPreview').focus();};$('previewFindText').oninput=()=>search(true);
 $('previewFindPrevious').onclick=()=>move(-1);$('previewFindNext').onclick=()=>move(1);
 $('previewFindText').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();move(e.shiftKey?-1:1);}};
 $('preview').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'){e.preventDefault();open();}if(e.key==='Escape'&&!$('previewFind').hidden){e.preventDefault();e.stopPropagation();close();$('findInPreview').focus();}});
 $('wrapPreview').onclick=()=>{wrap=!wrap;try{localStorage.setItem('agentmeld-preview-wrap',String(wrap));}catch{}applyWrap();};
 $('copyFilename').onclick=()=>{const f=getFile();if(f)copy(f.name.split('/').pop());};
 return {reset(){close();},refresh(){const file=getFile(),isText=typeof file?.text==='string';$('findInPreview').hidden=!isText;$('wrapPreview').hidden=!isText;$('previewTitle').title=file?.name||'';applyWrap();search();}};
}
