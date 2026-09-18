// Persist only application-owned milestones, never provider payloads or command output.
const labels={queued:'Queued',started:'Started',restored:'Working files ready',thinking:'Agent ready',saving:'Saving results',completed:'Completed',failed:'Failed',cancelled:'Stopped',interrupted:'Interrupted by service restart',cancelling:'Stop requested'};
export function recordEvent(task,kind){
  if(!Object.hasOwn(labels,kind))throw Error('Unknown activity milestone');
  task.events??=[];
  if(task.events.some(e=>e.kind===kind))return;
  task.events.push({id:task.id+':'+kind,kind,at:new Date().toISOString()});
}
export function publicEvents(task){
  return (task.events||[]).filter(e=>Object.hasOwn(labels,e.kind)).slice(0,16).map(e=>({id:e.id,kind:e.kind,at:e.at,label:labels[e.kind]}));
}
