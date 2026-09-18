// Bounded snapshot of regular working files, never credentials or host paths.
// Open each directory through an anchored descriptor; reject symlinks at every level.
export const snapshotProgram = `
const fs=require('node:fs');const entries=[];let total=0;
const readFlags=fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK;
function visit(fd,prefix,depth){
 if(depth>8)throw Error('Workspace directory depth exceeded');
 for(const name of fs.readdirSync('/proc/self/fd/'+fd)){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,119}$/.test(name))throw Error('Unsupported workspace name');
  const path=prefix+name, child=fs.openSync('/proc/self/fd/'+fd+'/'+name,readFlags);
  try{
   const stat=fs.fstatSync(child);
   if(entries.length>=128)throw Error('Workspace entry limit exceeded');
   if(stat.isDirectory()){entries.push({name:path,directory:true});visit(child,path+'/',depth+1);}
   else if(stat.isFile()){
    if(stat.size>2097152||total+stat.size>16777216)throw Error('Workspace size limit exceeded');
    const b=Buffer.alloc(stat.size);let used=0,count;
    while(used<b.length&&(count=fs.readSync(child,b,used,b.length-used,null)))used+=count;
    if(used!==stat.size||fs.fstatSync(child).size!==stat.size)throw Error('Workspace changed during capture');
    total+=used;entries.push({name:path,data:b.toString('base64')});
   }else throw Error('Unsupported workspace entry');
  }finally{fs.closeSync(child);}
 }
}
const root=fs.openSync('/workspace',readFlags);try{visit(root,'',0);}finally{fs.closeSync(root);}
process.stdout.write(JSON.stringify(entries));
`;
export const restoreProgram = `
const fs=require('node:fs');let text='';
process.stdin.on('data',c=>{text+=c;if(text.length>24000000)process.exit(1)});
process.stdin.on('end',()=>{
 const files=JSON.parse(text);if(!Array.isArray(files)||files.length>133)throw Error('Invalid workspace');
 for(const f of files){
  if(typeof f.name!=='string'||!f.name.split('/').every(n=>/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,119}$/.test(n)))throw Error('Invalid path');
  if(f.directory)fs.mkdirSync('/workspace/'+f.name,{mode:0o700});
  else fs.writeFileSync('/workspace/'+f.name,Buffer.from(f.data,'base64'),{flag:'wx',mode:0o600});
 }
});
`;
