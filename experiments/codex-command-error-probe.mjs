// Offline comparison of native command lifecycle and model-facing result. No credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { runCommandFixture } from './codex-command-fixture.mjs';
const home = '/tmp/command-error';
await mkdir(home + '/.codex', { recursive: true });
await writeFile(home + '/.codex/config.toml', `default_permissions="fixture"
[permissions.fixture.filesystem]
":root"="read"
"${home}"="deny"
"/workspace"="write"
[permissions.fixture.network]
enabled=false
`);
const results = [];
for (const unifiedExec of [true, false]) for (const code of [0, 23]) {
  const result = await runCommandFixture({ home, unifiedExec, command: `node -e 'process.exit(${code})'` });
  results.push({ unifiedExec, requestedExitCode: code, ...result });
}
console.log(JSON.stringify({ phase: 'm0', liveInference: false, realCredentialsUsed: false, results }));
for (const result of results) {
  assert.equal(result.returnedExitCode, result.requestedExitCode);
  assert.deepEqual(result.commandExitCodes, [result.requestedExitCode]);
}
