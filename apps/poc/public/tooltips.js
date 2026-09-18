const tip=document.getElementById('tooltip');
let target=null,timer=null;
function hide(){
 clearTimeout(timer);timer=null;
 if(target){const ids=(target.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==tip.id);if(ids.length)target.setAttribute('aria-describedby',ids.join(' '));else target.removeAttribute('aria-describedby');}
 target=null;if(tip.matches(':popover-open'))tip.hidePopover();
}
function show(button,delay=0){
 hide();if(!button||button.disabled)return;target=button;
 timer=setTimeout(()=>{
  if(!button.isConnected||target!==button)return hide();
  (button.closest('dialog')||document.body).append(tip);
  tip.textContent=button.getAttribute('aria-label');if(!tip.textContent)return hide();
  tip.showPopover();
  const box=button.getBoundingClientRect(),size=tip.getBoundingClientRect();
  let left=button.closest('.rail')?box.right+12:box.left+(box.width-size.width)/2;
  let top=button.closest('.rail')?box.top+(box.height-size.height)/2:box.top-size.height-10;
  if(top<8)top=box.bottom+10;
  tip.style.left=Math.max(8,Math.min(left,innerWidth-size.width-8))+'px';
  tip.style.top=Math.max(8,Math.min(top,innerHeight-size.height-8))+'px';
  button.setAttribute('aria-describedby',[button.getAttribute('aria-describedby'),tip.id].filter(Boolean).join(' '));
 },delay);
}
document.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const b=e.target.closest('[data-tooltip]');if(b&&target!==b)show(b,180);});
document.addEventListener('pointerout',e=>{if(target?.contains(e.target)&&!target.contains(e.relatedTarget))hide();});
document.addEventListener('focusin',e=>show(e.target.closest('[data-tooltip]')));
document.addEventListener('focusout',hide);
document.addEventListener('pointerdown',hide,true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&target){e.preventDefault();e.stopImmediatePropagation();hide();}},true);
window.addEventListener('resize',hide);document.addEventListener('scroll',()=>{if(target===document.activeElement)show(target,80);else hide();},true);
new MutationObserver(()=>{if(target&&!target.isConnected)hide();}).observe(document.body,{childList:true,subtree:true});
