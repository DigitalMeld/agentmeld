// Explicit disposable container probe; no subscription or credential mounts.
import { execFileSync } from 'node:child_process';
import { snapshotProgram, restoreProgram } from '../apps/worker/workspace.mjs';
const program=`const fs=require('node:fs'),assert=require('node:assert/strict');
fs.writeFileSync('/workspace/.notes','hidden fixture');fs.mkdirSync('/workspace/nested');fs.writeFileSync('/workspace/nested/input.txt','fixture');
let captured='';const old=process.stdout.write;process.stdout.write=s=>{captured+=s;return true};
try{eval(${JSON.stringify(snapshotProgram)});}finally{process.stdout.write=old;}
const entries=JSON.parse(captured);assert.ok(entries.some(e=>e.name==='.notes'));const file=entries.find(e=>e.name==='nested/input.txt');assert.equal(file.data,Buffer.from('fixture').toString('base64'));assert.ok(Number.isFinite(Date.parse(file.modifiedAt)));
fs.mkdirSync('/workspace/restored');require('node:child_process').execFileSync(process.execPath,['-e',${JSON.stringify(restoreProgram.replaceAll('/workspace','/workspace/restored'))}],{input:JSON.stringify(entries)});assert.equal(fs.readFileSync('/workspace/restored/.notes','utf8'),'hidden fixture');assert.equal(fs.statSync('/workspace/restored/nested/input.txt').mtime.toISOString(),file.modifiedAt);fs.rmSync('/workspace/restored',{recursive:true});
fs.symlinkSync('/tmp','/workspace/escape');assert.throws(()=>eval(${JSON.stringify(snapshotProgram)}),/ELOOP/);fs.unlinkSync('/workspace/escape');
fs.writeFileSync('/workspace/large',Buffer.alloc(2097153));assert.throws(()=>eval(${JSON.stringify(snapshotProgram)}),/Workspace size limit exceeded/);fs.unlinkSync('/workspace/large');
fs.symlinkSync('/etc/passwd','/workspace/nested/link');assert.throws(()=>eval(${JSON.stringify(snapshotProgram)}),/ELOOP/);
console.log('Nested capture, directory/file symlink rejection and quota rejection passed');`;
const result=execFileSync('docker',['--context','colima-agentmeld-m0','run','--rm','--network=none','--read-only','--user=1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=128m','--cpus=1','--pids-limit=32','--tmpfs=/workspace:rw,nosuid,nodev,size=16777216,uid=1000,gid=1000,mode=700','agentmeld-m0:local','node','-e',program],{encoding:'utf8',timeout:30000});
console.log(result.trim());
