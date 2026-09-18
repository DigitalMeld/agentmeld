// Bounded, local-only helpers for artifact selection and safe previews.
export const artifactKey=e=>JSON.stringify([e.task.id,e.file.name]);
export function latestVersions(entries){const latest=new Map();for(const e of entries){const k=JSON.stringify([e.task.conversationId,e.file.name]);if(!latest.has(k)||latest.get(k).version<e.version)latest.set(k,e);}return entries.filter(e=>latest.get(JSON.stringify([e.task.conversationId,e.file.name]))===e);}
export const textFile=name=>/\.(md|txt|csv|json|log|js|mjs|ts|py|sh|toml|yaml|yml|html?|css|xml|ini|cfg|svg)$/i.test(name)||name.split('/').pop().startsWith('.');
export function csvRows(text,limit=101){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';if(rows.length>=limit)return rows;}else cell+=c;}if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
export function manifest(entries){return {format:'agentmeld-artifacts-v1',files:entries.map(e=>({path:e.task.id+'/'+e.file.name,conversation:e.title,conversationId:e.task.conversationId,turnId:e.task.id,name:e.file.name,version:e.version,size:e.file.size,createdAt:e.task.createdAt}))};}
// ZIP store format (no compression): bounded export, no dependency or remote upload.
export function zipFiles(files){
 if(files.length>501)throw Error('Select at most 500 files.');
 const enc=new TextEncoder(),parts=[],central=[];let offset=0,total=0;
 const header=(size,fields)=>{const b=new Uint8Array(size),v=new DataView(b.buffer);for(const [pos,value,width] of fields)width===2?v.setUint16(pos,value,true):v.setUint32(pos,value,true);return b;};
 for(const f of files){if(!f.name.split('/').every(p=>p&&p!=='.'&&p!=='..')||f.name.includes('\\')||f.name.includes('\0'))throw Error('Invalid archive path.');const name=enc.encode(f.name),data=f.data;if(!(data instanceof Uint8Array)||name.length>65535)throw Error('Invalid archive entry.');total+=data.length;if(total>33554432)throw Error('Select no more than 32 MB.');let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 const local=header(30,[[0,0x04034b50,4],[4,20,2],[6,0x800,2],[12,33,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2]]);
 parts.push(local,name,data);central.push(header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x800,2],[14,33,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[42,offset,4]]),name);offset+=30+name.length+data.length;
 }
 const length=central.reduce((n,b)=>n+b.length,0);return new Blob([...parts,...central,header(22,[[0,0x06054b50,4],[8,files.length,2],[10,files.length,2],[12,length,4],[16,offset,4]])],{type:'application/zip'});
}
