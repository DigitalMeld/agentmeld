// Default is a read-only plan. --create requires explicit owner authorization.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { mkdir, open, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { authConfig, storeLabels, validateStore, initializeStoreProgram, storeMount } from '../experiments/codex-auth-store.mjs';
const { values } = parseArgs({ options: { context: { type: 'string' }, create: { type: 'boolean', default: false } } });
if (!values.context) throw Error('explicit --context required');
const name = 'agentmeld-m0-codex-auth';
if (!values.create) {
  console.log(JSON.stringify({ operation: 'plan-only', context: values.context, volume: name, credentialPath: '/agentmeld-home/.codex/auth.json', storage: 'VM-local Docker volume; native Codex file backend', permissions: 'UID/GID 1000; directories 0700, initialized files 0600', nativeToolHomeAccess: 'deny', authentication: 'ChatGPT subscription only', importsHostCredentials: false, startsLogin: false, createsStorage: false, requiresExplicitAuthorization: true }, null, 2));
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = root + '.local/m0/subscription';
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const meta = await lstat(directory);
  assert.ok(meta.isDirectory() && !meta.isSymbolicLink() && meta.uid === process.getuid() && (meta.mode & 0o077) === 0);
  // Reserve a new operator record first. Partial setup is retained for explicit recovery.
  const record = await open(directory + '/store.jsonl', 'wx', 0o600);
  const docker = args => execFileSync('docker', ['--context', values.context, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  const instance = randomUUID(); const container = 'agentmeld-m0-auth-init-' + instance;
  try {
    assert.ok(!docker(['volume', 'ls', '--format', '{{.Name}}']).trim().split('\n').includes(name), 'existing auth store requires explicit recovery');
    const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim(); assert.match(image, /^sha256:[a-f0-9]{64}$/);
    const engine = docker(['info', '--format', '{{.ID}}']).trim(); assert.ok(engine);
    await record.writeFile(JSON.stringify({ version: 1, context: values.context, engine, name, instance, image, status: 'initializing' }) + '\n'); await record.sync();
    docker(['volume', 'create', ...Object.entries({ ...storeLabels, 'io.digitalmeld.agentmeld.instance': instance }).map(([k,v]) => '--label=' + k + '=' + v), name]);
    validateStore(JSON.parse(docker(['volume', 'inspect', name]))[0], name, instance);
    docker(['run', '--rm', '--name', container, '--read-only', '--network=none', '--user=0:0', '--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--mount=' + storeMount(name), image, 'node', '-e', initializeStoreProgram(instance)]);
    const verify = `const fs=require('node:fs');const assert=require('node:assert/strict');
assert.deepEqual(JSON.parse(fs.readFileSync('/agentmeld-home/store.json','utf8')),{version:1,instance:${JSON.stringify(instance)}});
assert.equal(fs.readFileSync('/agentmeld-home/.codex/config.toml','utf8'),${JSON.stringify(authConfig)});
for(const p of ['/agentmeld-home','/agentmeld-home/.codex','/agentmeld-home/store.json','/agentmeld-home/.codex/config.toml']){const s=fs.statSync(p);assert.equal(s.uid,1000);assert.equal(s.gid,1000);assert.equal(s.mode&0o077,0)};`;
    docker(['run', '--rm', '--name', container, '--read-only', '--network=none', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--mount=' + storeMount(name) + ',readonly', image, 'node', '-e', verify]);
    await record.writeFile(JSON.stringify({ version: 1, name, instance, status: 'initialized', loginStarted: false }) + '\n'); await record.sync();
    console.log(JSON.stringify({ initialized: true, name, instance, loginStarted: false, credentialsStored: false }));
  } finally {
    await record.close();
    if (docker(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n').includes(container)) docker(['rm', '-f', container]);
  }
}
