const $=id=>document.getElementById(id);
let profile=null,busy=false;
const dialog=$('agentDialog'),error=$('agentError');
async function request(data){
 const token=sessionStorage.getItem('agentmeld-token')||'';
 const response=await fetch('/api/agent',{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Could not load agent settings.');return value;
}
function render(){
 for(const [id,key] of [['agentName','name'],['agentIdentity','identity'],['agentPersona','persona'],['ownerProfile','profile']])$(id).value=profile[key];
 $('agentMemories').replaceChildren(...profile.memories.map(memory=>{
  const row=document.createElement('article'),text=document.createElement('p'),source=document.createElement('small'),remove=document.createElement('button');
  text.textContent=memory.text;source.textContent=memory.sourceTaskId?'From conversation · '+new Date(memory.createdAt).toLocaleDateString():'Added by you · '+new Date(memory.createdAt).toLocaleDateString();
  remove.textContent='Forget';remove.setAttribute('aria-label','Forget memory: '+memory.text.slice(0,60));remove.onclick=()=>mutate({action:'forget',id:memory.id},false);
  row.append(text,source,remove);return row;
 }));
 if(!profile.memories.length)$('agentMemories').textContent='No approved memories yet.';
}
function lock(value){busy=value;for(const b of dialog.querySelectorAll('button,input,textarea'))if(b.id!=='closeAgent')b.disabled=value;}
async function load(){if(busy)return;lock(true);error.textContent='';try{profile=await request();render();}catch(e){error.textContent=e.message;}finally{lock(false);}}
async function mutate(data,renderFields=true){
 if(busy||!profile)return;lock(true);error.textContent='';
 const draft=Object.fromEntries(['agentName','agentIdentity','agentPersona','ownerProfile'].map(id=>[id,$(id).value]));
 try{profile=await request({revision:profile.revision,...data});render();if(!renderFields)for(const [id,value] of Object.entries(draft))$(id).value=value;if(data.action==='remember')$('memoryText').value='';error.textContent='Saved.';}
 catch(e){error.textContent=e.message;}finally{lock(false);}
}
$('agentSettings').onclick=()=>{dialog.showModal();if(!profile)load();};
$('closeAgent').onclick=()=>dialog.close();
$('reloadAgent').onclick=load;
$('agentForm').onsubmit=e=>{e.preventDefault();mutate({action:'edit',name:$('agentName').value,identity:$('agentIdentity').value,persona:$('agentPersona').value,profile:$('ownerProfile').value});};
$('memoryForm').onsubmit=e=>{e.preventDefault();mutate({action:'remember',text:$('memoryText').value},false);};
$('exportAgent').onclick=()=>{if(!profile)return;const url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='agent-context.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
