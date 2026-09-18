// Pure browser helpers shared by the workspace tree and artifact layouts.
export function browseWorkspace(entries,path='',query='',hidden=true){
 const prefix=path?path+'/':'';const q=query.trim().toLocaleLowerCase();
 return entries.filter(e=>e.name.startsWith(prefix)&&(hidden||!e.name.split('/').some(p=>p.startsWith('.')))&&(q?e.name.toLocaleLowerCase().includes(q):!e.name.slice(prefix.length).includes('/'))).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,undefined,{numeric:true}));
}
export function fileKind(name){const ext=name.split('.').pop().toLowerCase();return ({md:'Markdown',txt:'Text',csv:'CSV',json:'JSON',html:'HTML',png:'Image',jpg:'Image',jpeg:'Image',gif:'Image',webp:'Image',pdf:'PDF',js:'JavaScript',mjs:'JavaScript',py:'Python',sh:'Shell'})[ext]||ext.toUpperCase();}
export function breadcrumbs(path){let prefix='';return [{name:'workspace',path:''},...path.split('/').filter(Boolean).map(name=>({name,path:prefix=prefix?prefix+'/'+name:name}))];}
export function readPreferences(storage){try{const v=JSON.parse(storage.getItem('agentmeld-files')||'{}');return {layouts:Object.fromEntries(Object.entries(v.layouts||{}).filter(([k,x])=>['all','documents','web','images','videos','audio'].includes(k)&&['grid','list'].includes(x))),sort:['newest','oldest','name','size','opened'].includes(v.sort)?v.sort:'newest',opened:Object.fromEntries(Object.entries(v.opened||{}).filter(([k,x])=>k.length<1500&&Number.isFinite(x)).slice(-100))};}catch{return {layouts:{},sort:'newest',opened:{}};}}
