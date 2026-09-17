// Explicit host-local inference qualification. No credentials, auto-pull or cloud fallback.
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { preflightOllama } from '../experiments/ollama-preflight.mjs';
import { runLoop } from '../experiments/ollama-loop.mjs';
import { durableSum } from '../experiments/ollama-durable-tool.mjs';
import { RustAuthority } from '../experiments/rust-browser-control.mjs';
const args = process.argv.slice(2);
if (![4, 5].includes(args.length) || args[0] !== '--endpoint' || args[2] !== '--model' || (args[4] && !['--run', '--run-fixture'].includes(args[4]))) throw new Error('usage: node scripts/probe-ollama.mjs --endpoint http://127.0.0.1:PORT --model EXACT_TAG [--run | --run-fixture]');
const endpoint = args[1]; const model = args[3];
const root = fileURLToPath(new URL('..', import.meta.url)); const runId = randomUUID();
const directory = join(root, '.local/m0/control', runId);
await mkdir(directory, { recursive: true, mode: 0o700 });
const binary = join(root, 'target/debug/agentmeld-m0');
const report = { phase: 'm0', runId, inferenceRequested: args[4] === '--run', fixtureTransport: args[4] === '--run-fixture', liveInferenceQualified: false, cases: [] };
let authority;
try {
  report.model = await preflightOllama({ endpoint, model });
  if (report.inferenceRequested || report.fixtureTransport) {
    for (const scenario of ['allow', 'deny', 'cancel_stream']) {
      // Recheck the installed digest before every case; a changed tag fails qualification.
      const current = await preflightOllama({ endpoint, model });
      assert.equal(current.digest, report.model.digest);
      authority = await RustAuthority.open(binary, join(directory, scenario + '.jsonl'));
      const stats = { executions: 0, results: [] }; const abort = new AbortController(); let interrupted = false;
      const execute = durableSum({ authority, binary, scope: { workspace: 'ollama-qualification', worker: 'ollama:' + current.digest, thread: runId, turn: scenario }, allow: scenario === 'allow', stats });
      const began = performance.now(); let outcome;
      try {
        const result = await runLoop({ endpoint, model, execute, signal: abort.signal, timeoutMs: 120000, onChunk: () => { if (scenario === 'cancel_stream') { interrupted = true; abort.abort(); } } });
        assert.equal(scenario, 'allow'); assert.ok(stats.executions > 0); assert.ok(stats.results.every(value => value === 5)); assert.match(result.text, /(?:^|\D)5(?:\D|$)/);
        outcome = { completed: true, turns: result.turns };
      } catch (error) {
        if (scenario === 'deny' && error.message === 'fixture approval denied') { assert.equal(stats.executions, 0); outcome = { denied: true }; }
        else if (scenario === 'cancel_stream' && interrupted && error.name === 'AbortError') { assert.equal(stats.executions, 0); await authority.request({ op: 'cancel' }); assert.equal(authority.current.mode, 'cancelled'); outcome = { callerStreamAborted: true, cancellationPersisted: true }; }
        else throw error;
      }
      report.cases.push({ scenario, ...outcome, toolExecutions: stats.executions, elapsedMs: Math.round(performance.now() - began) });
      await authority.close(); authority = null;
    }
    const final = await preflightOllama({ endpoint, model }); assert.equal(final.digest, report.model.digest);
    report.qualificationPassed = true;
    report.liveInferenceQualified = !report.fixtureTransport;
  }
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  if (authority) await authority.close();
  await writeFile(join(directory, 'ollama-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
