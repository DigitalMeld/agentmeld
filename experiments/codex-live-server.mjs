// Container-only native app-server launcher for the host-owned browser qualification.
import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { authHome, validateRuntimeAuthConfig } from './codex-auth-store.mjs';
const proxy = process.env.AGENTMELD_PROXY_IP; assert.match(proxy, /^\d+\.\d+\.\d+\.\d+$/);
validateRuntimeAuthConfig(await readFile(authHome + '/.codex/config.toml', 'utf8'));
assert.equal(JSON.parse(await readFile(authHome + '/store.json', 'utf8')).instance, process.env.AGENTMELD_STORE_INSTANCE);
const auth = await stat(authHome + '/.codex/auth.json'); assert.equal(auth.uid, 1000); assert.equal(auth.mode & 0o777, 0o600);
const binary = '/opt/agentmeld/node_modules/.bin/codex';
execFileSync(binary, ['sandbox', '-P', 'agentmeld', '-C', '/workspace', '--', 'node', '-e',
  "const fs=require('node:fs'),a=require('node:assert/strict');for(const flags of ['r','r+'])a.throws(()=>{const fd=fs.openSync('/agentmeld-home/.codex/auth.json',flags);fs.closeSync(fd)})"],
{ env: { PATH: process.env.PATH, HOME: authHome, CODEX_HOME: authHome + '/.codex' }, timeout: 10000, stdio: ['ignore','pipe','pipe'] });
const endpoint = `http://${proxy}:8443`;
const child = spawn(binary, ['app-server', '--stdio'], { cwd: '/workspace', env: {
  PATH: process.env.PATH, HOME: authHome, CODEX_HOME: authHome + '/.codex',
  HTTPS_PROXY: endpoint, HTTP_PROXY: endpoint, ALL_PROXY: endpoint,
  https_proxy: endpoint, http_proxy: endpoint, all_proxy: endpoint,
  NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
}, stdio: ['inherit', 'inherit', 'ignore'] });
let stopping = false;
child.on('error', () => process.exit(1));
child.on('exit', code => process.exit(code === 0 || stopping ? 0 : 1));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child.kill(signal); });
