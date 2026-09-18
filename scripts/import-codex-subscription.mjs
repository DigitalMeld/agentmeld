// Requires explicit owner authorization. Copies one auth file through stdin, never a host mount.
import { execFileSync } from 'node:child_process';
import { open, readFile, appendFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { subscriptionAuthBytes, importProgram } from '../experiments/auth-import.mjs';
import { validateStore, storeMount, authConfig } from '../experiments/codex-auth-store.mjs';
const { values } = parseArgs({ options: { context: { type: 'string' }, import: { type: 'boolean', default: false } } });
if (!values.context) throw Error('explicit context required');
if (!values.import) { console.log(JSON.stringify({ planOnly: true, source: '~/.codex/auth.json', destination: 'agentmeld-m0-codex-auth', copiesSettings: false, startsLogin: false })); }
else {
  const root = fileURLToPath(new URL('../', import.meta.url)); const record = root + '.local/m0/subscription/store.jsonl';
  const events = (await readFile(record, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const created = events[0]; assert.ok(events.some(e => e.status === 'initialized' && e.instance === created.instance));
  assert.equal(created.context, values.context);
  const docker = (args, options = {}) => execFileSync('docker', ['--context', values.context, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, ...options });
  assert.equal(docker(['info', '--format', '{{.ID}}']).trim(), created.engine);
  validateStore(JSON.parse(docker(['volume', 'inspect', created.name]))[0], created.name, created.instance);
  const image = docker(['image', 'inspect', 'agentmeld-m0:local', '--format', '{{.Id}}']).trim(); assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const source = await open(homedir() + '/.codex/auth.json', constants.O_RDONLY | constants.O_NOFOLLOW);
  const container = 'agentmeld-m0-auth-import-' + randomUUID();
  try {
    const stat = await source.stat(); assert.ok(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.size <= 1048576);
    const original = await source.readFile(); const payload = subscriptionAuthBytes(original);
    const output = docker(['run', '--rm', '-i', '--name', container, '--read-only', '--network=none', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--cpus=1', '--pids-limit=64', '--mount=' + storeMount(created.name), image, 'node', '-e', importProgram(created.instance, authConfig)], { input: payload });
    const receipt = JSON.parse(output); assert.ok(receipt.imported && receipt.privateModesVerified && receipt.readbackVerified);
    const unchanged = createHash('sha256').update(await readFile(homedir() + '/.codex/auth.json')).digest().equals(createHash('sha256').update(original).digest());
    assert.ok(unchanged, 'source changed during import; inspect before proceeding');
    await appendFile(record, JSON.stringify({ version: 1, instance: created.instance, status: 'subscription-auth-imported', method: 'owner-authorized-single-file', sourceUnchanged: true }) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ ...receipt, sourceUnchanged: true, settingsCopied: false, loginStarted: false }));
  } finally {
    await source.close();
    if (docker(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n').includes(container)) docker(['rm', '-f', container]);
  }
}
