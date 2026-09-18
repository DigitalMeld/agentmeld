// Explicit offline native-sandbox qualification; all credential bytes are synthetic.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, symlink, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { runCommandFixture } from './codex-command-fixture.mjs';
const codex = '/opt/agentmeld/node_modules/.bin/codex';
const home = '/tmp/codex-boundary'; const credential = home + '/.codex/canary';
await mkdir(home + '/.codex', { recursive: true });
const canary = randomUUID(); await writeFile(credential, canary, { mode: 0o600 });
assert.equal(await readFile(credential, 'utf8'), canary);
await writeFile(home + '/.codex/config.toml', `default_permissions = "fixture"
[permissions.fixture.filesystem]
":root" = "read"
"${home}" = "deny"
"/workspace" = "write"
[permissions.fixture.network]
enabled = false
`);
const run = randomUUID(); const alias = '/workspace/link-' + run; const imageAlias = '/workspace/image-link-' + run; const result = '/workspace/boundary-' + run + '.json';
await symlink(credential, alias);
const parentStatus = await readFile('/proc/self/status', 'utf8');
const attributes = async () => (await readFile('/proc/self/attr/current', 'utf8')).trim();
const outerProfile = await attributes();
assert.match(outerProfile, /^agentmeld-m0-codex \(enforce\)$/);
assert.match(parentStatus, /CapEff:\s+0+\n/); assert.match(parentStatus, /NoNewPrivs:\s+1/); assert.match(parentStatus, /Seccomp:\s+2/);
const script = `const fs=require('node:fs');
const paths=${JSON.stringify([credential, alias, '/proc/' + process.pid + '/root' + credential, '/proc/self/root' + credential])};
const checks=paths.map(path=>{try{fs.readFileSync(path);return false}catch(error){return ['EACCES','EPERM','ENOENT','ENOTDIR'].includes(error.code)}});
const writes=paths.map(path=>{try{fs.appendFileSync(path,'forbidden');return false}catch(error){return ['EACCES','EPERM','ENOENT','ENOTDIR','EROFS'].includes(error.code)}});
const status=fs.readFileSync('/proc/self/status','utf8');
fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({checks,writes,capEff:status.match(/CapEff:\\s+(\\w+)/)[1],noNewPrivs:Number(status.match(/NoNewPrivs:\\s+(\\d+)/)[1]),seccomp:Number(status.match(/Seccomp:\\s+(\\d+)/)[1]),pidDepth:status.match(/NSpid:\\s+([^\\n]+)/)[1].trim().split(/\\s+/).length}));
if(!checks.every(Boolean)||!writes.every(Boolean))process.exitCode=1;`;
let step = 'standalone-command';
try {
  execFileSync(codex, ['sandbox', '-P', 'fixture', '-C', '/workspace', '--', 'node', '-e', script], {
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: home + '/.codex' },
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 1024 * 1024,
  });
  const child = JSON.parse(await readFile(result, 'utf8'));
  await unlink(result);
  const scriptPath = '/workspace/native-boundary-' + run + '.cjs';
  await writeFile(scriptPath, script);
  step = 'native-command';
  const native = await runCommandFixture({ home, command: 'node ' + scriptPath });
  console.log(JSON.stringify({ phase: 'm0', nativeToolInventory: native.advertisedTools }));
  const nativeChild = JSON.parse(await readFile(result, 'utf8'));
  assert.deepEqual(nativeChild.checks, [true, true, true, true]);
  assert.deepEqual(nativeChild.writes, [true, true, true, true]);
  assert.match(nativeChild.capEff, /^0+$/); assert.equal(nativeChild.noNewPrivs, 1); assert.equal(nativeChild.seccomp, 2);
  assert.deepEqual(child.checks, [true, true, true, true]); assert.match(child.capEff, /^0+$/);
  assert.deepEqual(child.writes, [true, true, true, true]);
  assert.equal(child.noNewPrivs, 1); assert.equal(child.seccomp, 2);
  assert.equal(await readFile(credential, 'utf8'), canary);
  const patchControl = '/workspace/patch-' + run + '.txt';
  step = 'workspace-patch';
  const positivePatch = await runCommandFixture({ home, patch: `*** Begin Patch\n*** Add File: ${patchControl}\n+workspace control\n*** End Patch` });
  assert.equal(await readFile(patchControl, 'utf8'), 'workspace control\n');
  const deniedPatches = [];
  for (const path of [credential, alias]) {
    step = path === credential ? 'credential-patch' : 'symlink-patch';
    const denied = await runCommandFixture({ home, patch: `*** Begin Patch\n*** Delete File: ${path}\n*** End Patch` });
    assert.equal(await readFile(credential, 'utf8'), canary);
    assert.equal(await readFile(alias, 'utf8'), canary);
    deniedPatches.push(denied);
  }
  step = 'workspace-image';
  // Valid synthetic image; success outside the denied home is a required control.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DA8B+MgBgAHfAD/dPQfSYAAAAASUVORK5CYII=', 'base64');
  const workspaceImage = '/workspace/image-' + run + '.png';
  const privateImage = home + '/.codex/image.png';
  await writeFile(workspaceImage, png); await writeFile(privateImage, png);
  await symlink(privateImage, imageAlias);
  const imageControl = await runCommandFixture({ home, imagePath: workspaceImage });
  assert.equal(imageControl.imageReturned, true);
  step = 'credential-image';
  const deniedImage = await runCommandFixture({ home, imagePath: privateImage });
  assert.equal(deniedImage.imageReturned, false);
  step = 'symlink-image';
  const deniedImageAlias = await runCommandFixture({ home, imagePath: imageAlias });
  assert.equal(deniedImageAlias.imageReturned, false);
  console.log(JSON.stringify({ phase: 'm0', version: execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim(),
    nativeCommand: native, nativePatch: { positive: positivePatch, denied: deniedPatches }, nativeImage: { positive: imageControl, denied: [deniedImage, deniedImageAlias] }, profile: outerProfile, parentCanReadCanary: true, childCredentialPathsDenied: child.checks.length, childCredentialWritesDenied: child.writes.length,
    workspaceWriteVerified: true, outerCapabilitiesZero: true, childCapabilitiesZero: true,
    childNoNewPrivs: child.noNewPrivs, childSeccomp: child.seccomp, childPidDepth: child.pidDepth,
    liveInferenceQualified: false, realCredentialsUsed: false }));
} catch {
  // Never retain the canary bytes or child diagnostics in an exported report.
  console.log(JSON.stringify({ phase: 'm0', step, failure: 'native credential boundary unqualified', liveInferenceQualified: false, realCredentialsUsed: false }));
  process.exitCode = 1;
} finally {
  await unlink(alias);
  await unlink(imageAlias).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
