// Owner-authorized subscription readback and one synthetic-content live turn. No raw account/output logs.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { validateRuntimeAuthConfig, authHome } from './codex-auth-store.mjs';
const proxy = process.env.AGENTMELD_PROXY_IP; assert.match(proxy, /^\d+\.\d+\.\d+\.\d+$/);
validateRuntimeAuthConfig(await readFile(authHome + '/.codex/config.toml', 'utf8'));
assert.ok(JSON.parse(await readFile(authHome + '/store.json', 'utf8')).instance === process.env.AGENTMELD_STORE_INSTANCE);
const authStat = await stat(authHome + '/.codex/auth.json'); assert.ok(authStat.uid === 1000 && (authStat.mode & 0o777) === 0o600);
execFileSync('/opt/agentmeld/node_modules/.bin/codex', ['sandbox', '-P', 'agentmeld', '-C', '/workspace', '--', 'node', '-e',
  "const fs=require('node:fs'),assert=require('node:assert/strict');for(const flags of ['r','r+']){assert.throws(()=>{const fd=fs.openSync('/agentmeld-home/.codex/auth.json',flags);fs.closeSync(fd)})}"],
  { env: { PATH: process.env.PATH, HOME: authHome, CODEX_HOME: authHome + '/.codex' }, timeout: 10000, stdio: ['ignore','pipe','pipe'] });
const endpoint = `http://${proxy}:8443`;
const proc = spawn('/opt/agentmeld/node_modules/.bin/codex', ['app-server', '--stdio'], { cwd: '/workspace', env: {
  PATH: process.env.PATH, HOME: authHome, CODEX_HOME: authHome + '/.codex', HTTPS_PROXY: endpoint, HTTP_PROXY: endpoint, ALL_PROXY: endpoint,
  https_proxy: endpoint, http_proxy: endpoint, all_proxy: endpoint, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}, stdio: ['pipe', 'pipe', 'pipe'] });
const diagnosticFlags = new Set();
const inspectError = value => { const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? ''); for (const term of ['sending request','connection','decode','EOF','certificate','tls','websocket','timeout','401','403','407','429','stream disconnected']) if (text.toLowerCase().includes(term.toLowerCase())) diagnosticFlags.add(term); };
let stage = 'initialize'; let buffer = ''; let next = 0; let closing = false; let failed = false; let answer = ''; let streamed = false;
const pending = new Map(); let resolveTurn; let rejectTurn;
const turn = new Promise((resolve,reject) => { resolveTurn=resolve;rejectTurn=reject; }); turn.catch(()=>{});
const fail = () => { if (closing) return; failed = true; for(const p of pending.values())p.reject(Error('native unavailable'));pending.clear();rejectTurn(Error('native unavailable'));proc.kill('SIGKILL'); };
proc.on('error',fail);proc.on('exit',fail);proc.stdin.on('error',fail);proc.stderr.on('data', chunk => inspectError(chunk.toString()));
proc.stdout.on('data',chunk=>{
  buffer+=chunk; if(Buffer.byteLength(buffer)>1048576)return fail(); let end;
  while((end=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let frame;try{frame=JSON.parse(line);}catch{return fail();}
    if(frame.method&&frame.id!==undefined){proc.stdin.write(JSON.stringify({id:frame.id,error:{code:-32601,message:'No tool approvals in subscription smoke test'}})+'\n');continue;}
    const p=pending.get(frame.id);if(p){pending.delete(frame.id);if(frame.error)p.reject(Error('native rejected'));else p.resolve(frame.result);}
    if(frame.method==='item/agentMessage/delta'){streamed=true;answer+=String(frame.params?.delta??'');if(answer.length>8192)return fail();}
    if(frame.method==='item/completed'&&frame.params?.item?.type==='agentMessage'&&!streamed)answer=String(frame.params.item.text??'').slice(0,8192);
    if(frame.method==='error')inspectError(frame.params);
    if(frame.method==='turn/completed'&&frame.params?.turn?.error)inspectError(frame.params.turn.error);
    if(frame.method==='turn/completed')resolveTurn(frame.params?.turn?.status);
  }
});
const request=(method,params)=>failed?Promise.reject(Error('native unavailable')):new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});proc.stdin.write(JSON.stringify({id,method,params})+'\n');});
const deadline=setTimeout(fail,60000);
let recognized=false;let modelAvailable=false;
try{
  await request('initialize',{clientInfo:{name:'agentmeld_m0_subscription',version:'0.1.0'}});proc.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  stage='account-readback';const account=await request('account/read',{refreshToken:false});assert.ok(account.account?.type==='chatgpt');recognized=true;
  stage='model-availability';const models=await request('model/list',{limit:100});modelAvailable=models.data.some(m=>m.model==='gpt-5.5');assert.ok(modelAvailable);
  stage='thread-start';const thread=await request('thread/start',{cwd:'/workspace',model:'gpt-5.5',approvalPolicy:'on-request',ephemeral:true});
  stage='live-turn';await request('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Reply with exactly M0_READY. Do not use any tools.',text_elements:[]}]});
  assert.ok(await turn==='completed');assert.ok(answer.trim()==='M0_READY');assert.ok(streamed);
  console.log(JSON.stringify({phase:'m0',subscriptionRecognized:recognized,model:'gpt-5.5',modelAvailable,liveStreamVerified:true,expectedAnswerVerified:true,apiKeyUsed:false,rawAccountOrOutputRetained:false}));
}catch{console.log(JSON.stringify({phase:'m0',failedStage:stage,diagnosticFlags:[...diagnosticFlags],subscriptionRecognized:recognized,modelAvailable,liveStreamVerified:false,rawAccountOrOutputRetained:false}));process.exitCode=1;}
finally{clearTimeout(deadline);closing=true;const exited=new Promise(resolve=>{if(proc.exitCode!==null||proc.signalCode)resolve();else proc.once('exit',resolve);});proc.stdin.end();proc.kill('SIGTERM');const kill=setTimeout(()=>proc.kill('SIGKILL'),1000);await exited;clearTimeout(kill);}
