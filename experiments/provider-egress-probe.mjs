// Explicit unauthenticated network probe, never part of default local tests.
import { request } from 'node:http';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Resolver } from 'node:dns/promises';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const proxy = process.env.AGENTMELD_PROXY_IP;
assert.match(proxy, /^\d+\.\d+\.\d+\.\d+$/);
assert.match(process.env.AGENTMELD_GATEWAY_IP, /^\d+\.\d+\.\d+\.\d+$/);
async function tunnel(authority) {
  return new Promise((resolve, reject) => {
    const req = request({ host: proxy, port: 8443, method: 'CONNECT', path: authority, headers: { Host: authority }, timeout: 8000 });
    req.once('error', reject); req.once('timeout', () => req.destroy(Error('connect deadline')));
    req.once('connect', (res, socket) => resolve({ status: res.statusCode, socket })); req.end();
  });
}
async function deniedTcp(host, port) {
  return new Promise(resolve => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(true); }, 1500);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    socket.once('error', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
  });
}
const denied = [];
for (const authority of ['example.com:443', '127.0.0.1:443', '169.254.169.254:443', 'auth.openai.com:80', 'auth.openai.com.evil.example:443']) {
  const result = await tunnel(authority); denied.push(result.status === 403); result.socket.destroy();
}
assert.ok(denied.every(Boolean));
const directPublicDenied = await deniedTcp('1.1.1.1', 443); assert.ok(directPublicDenied);
const hostBridgeDenied = await deniedTcp(process.env.AGENTMELD_GATEWAY_IP, 22); assert.ok(hostBridgeDenied);
const resolver = new Resolver({ timeout: 500, tries: 1 });
let dnsDenied = false;
try { await resolver.resolve4('example.com'); } catch { dnsDenied = true; }
assert.ok(dnsDenied);
const allowed = await tunnel('auth.openai.com:443'); assert.equal(allowed.status, 200);
const tlsAuthorized = await new Promise((resolve, reject) => {
  const socket = tlsConnect({ socket: allowed.socket, servername: 'auth.openai.com', rejectUnauthorized: true });
  socket.setTimeout(8000, () => socket.destroy(Error('TLS deadline')));
  socket.once('error', reject);
  socket.once('secureConnect', () => { const verified = socket.authorized; socket.destroy(); resolve(verified); });
});
assert.ok(tlsAuthorized);
const home = '/tmp/private-home'; const workspace = '/tmp/public-work';
await mkdir(home + '/.codex', { recursive: true }); await mkdir(workspace);
await writeFile(home + '/.codex/config.toml', `default_permissions = "fixture"
[permissions.fixture.filesystem]
":root" = "read"
"${home}" = "deny"
"${workspace}" = "write"
[permissions.fixture.network]
enabled = false
`);
const script = `const fs=require('node:fs');const net=require('node:net');
const check=(host,port)=>new Promise(resolve=>{const socket=net.connect({host,port});const timer=setTimeout(()=>{socket.destroy();resolve(true)},1000);socket.on('connect',()=>{clearTimeout(timer);socket.destroy();resolve(false)});socket.on('error',()=>{clearTimeout(timer);socket.destroy();resolve(true)})});
Promise.all([check(${JSON.stringify(proxy)},8443),check('1.1.1.1',443)]).then(denied=>fs.writeFileSync('${workspace}/network.json',JSON.stringify({denied})));`;
execFileSync('/opt/agentmeld/node_modules/.bin/codex', ['sandbox', '-P', 'fixture', '-C', workspace, '--', 'node', '-e', script], { env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home + '/.codex' }, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
const native = JSON.parse(await readFile(workspace + '/network.json', 'utf8'));
assert.deepEqual(native.denied, [true, true]);
console.log(JSON.stringify({ phase: 'm0', deniedDestinations: denied.length, directPublicDenied, hostBridgeDenied, dnsDenied, providerTlsVerified: tlsAuthorized, nativeSandboxProxyDenied: native.denied[0], nativeSandboxPublicDenied: native.denied[1], loginStarted: false, credentialsUsed: false, liveInference: false }));
