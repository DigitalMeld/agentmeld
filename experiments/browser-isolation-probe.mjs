// Native Codex command fixture in a harness container separate from the browser.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { runCommandFixture } from './codex-command-fixture.mjs';
const home = '/tmp/isolated-harness'; await mkdir(home + '/.codex', { recursive: true });
await writeFile(home + '/.codex/config.toml', 'default_permissions = "fixture"\n[permissions.fixture.filesystem]\n":root" = "read"\n"/workspace" = "write"\n[permissions.fixture.network]\nenabled = false\n');
const program = `const fs=require('node:fs');const assert=require('node:assert/strict');
const paths=['/tmp/private-browser-profile/synthetic-canary','/proc/1/root/tmp/private-browser-profile/synthetic-canary','/var/run/docker.sock'];
for(const p of paths){assert.throws(()=>fs.readFileSync(p));assert.throws(()=>fs.appendFileSync(p,'attempt'));}
fs.writeFileSync('/workspace/isolation-result.json',JSON.stringify({deniedPaths:paths.length,pidNamespace:fs.readlinkSync('/proc/self/ns/pid'),networkNamespace:fs.readlinkSync('/proc/self/ns/net')}));`;
const encoded = Buffer.from(program).toString('base64');
const turn = await runCommandFixture({ home, command: `node -e "eval(Buffer.from('${encoded}','base64').toString())"` });
assert.equal(turn.status, 'completed');
const result = JSON.parse(await readFile('/workspace/isolation-result.json', 'utf8'));
assert.equal(result.deniedPaths, 3);
console.log(JSON.stringify({ ...result, nativeCommandVerified: true, liveInference: false }));
