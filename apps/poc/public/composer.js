export function formatBytes(bytes){
  if(bytes<1024)return bytes+' B';
  if(bytes<1024*1024)return (bytes/1024).toFixed(bytes<10240?1:0)+' KB';
  return (bytes/(1024*1024)).toFixed(1)+' MB';
}
export function validateAttachments(existing,incoming){
  const combined=[...existing,...incoming];
  if(combined.length>5)throw Error('Attach up to five files.');
  const names=new Set();let total=0;
  for(const file of combined){
    if(!/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,119}$/.test(file.name)||file.name==='..')throw Error('Use filenames beginning with a letter or number, followed by letters, numbers, spaces, dots, underscores or hyphens (up to 120 characters).');
    if(names.has(file.name))throw Error('An attachment named '+file.name+' already exists. Rename it first.');
    names.add(file.name);
    const size=file.size??atob(file.data).length;
    if(size>2*1024*1024)throw Error('Each file must be 2 MB or smaller.');
    total+=size;
  }
  if(total>5*1024*1024)throw Error('Attachments must total 5 MB or less.');
}
