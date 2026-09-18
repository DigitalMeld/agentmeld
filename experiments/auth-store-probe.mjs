// Synthetic credentials only; run with the disposable auth-store fixture volume.
import { readFile, writeFile, stat, symlink, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { authConfig, authHome } from './codex-auth-store.mjs';
const instance = process.env.AGENTMELD_STORE_INSTANCE;
const home = authHome + '/.codex';
const marker = JSON.parse(await readFile(authHome + '/store.json', 'utf8'));
assert.deepEqual(marker, { version: 1, instance });
assert.equal(await readFile(home + '/config.toml', 'utf8'), authConfig);
for (const path of [authHome, home, home + '/config.toml', authHome + '/store.json']) {
  const info = await stat(path); assert.equal(info.uid, 1000); assert.equal(info.gid, 1000); assert.equal(info.mode & 0o077, 0);
}
const credential = home + '/canary'; const canary = 'synthetic-' + instance;
if (process.env.AGENTMELD_STORE_FIRST === '1') await writeFile(credential, canary, { flag: 'wx', mode: 0o600 });
assert.equal(await readFile(credential, 'utf8'), canary);
const alias = '/workspace/credential-link'; await symlink(credential, alias);
const script = `const fs=require('node:fs');const paths=${JSON.stringify([credential, alias, home + '/config.toml'])};
const checks=paths.map(path=>{let read=false,write=false;try{fs.readFileSync(path)}catch(e){read=['EACCES','ENOENT','EPERM','ENOTDIR'].includes(e.code)}try{fs.appendFileSync(path,'denied')}catch(e){write=['EACCES','ENOENT','EPERM','ENOTDIR','EROFS'].includes(e.code)}return {read,write}});
fs.writeFileSync('/workspace/result.json',JSON.stringify(checks));`;
try {
  execFileSync('/opt/agentmeld/node_modules/.bin/codex', ['sandbox', '-P', 'agentmeld', '-C', '/workspace', '--', 'node', '-e', script], { env: { PATH: process.env.PATH, HOME: authHome, CODEX_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
  const result = JSON.parse(await readFile('/workspace/result.json', 'utf8'));
  assert.deepEqual(result, Array(3).fill({ read: true, write: true }));
  assert.equal(await readFile(credential, 'utf8'), canary);
  assert.equal(await readFile(home + '/config.toml', 'utf8'), authConfig);
  console.log(JSON.stringify({ phase: 'm0', persistedCanaryRead: true, privateModesVerified: true, nativeReadDenials: 3, nativeWriteDenials: 3, realCredentials: false, loginStarted: false }));
} finally { await unlink(alias); }
