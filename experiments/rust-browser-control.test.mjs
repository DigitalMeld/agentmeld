import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RustAuthority, RustBrowserControl } from './rust-browser-control.mjs';
const binary = 'target/debug/agentmeld-m0';
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agentmeld-journal-'));
  const journal = join(directory, 'control.jsonl');
  const owners = [];
  const open = async () => { const owner = await RustAuthority.open(binary, journal); owners.push(owner); return owner; };
  try { await run(open, journal); } finally { for (const owner of owners) await owner.close(); await rm(directory, { recursive: true }); }
}

test('Rust owns admission, takeover and observation across process replacement', async () => fixture(async open => {
  let value = 0;
  const computer = { agentClick: async () => { value++; }, humanClick: async () => { value++; }, observe: async () => ({ value }) };
  const owner = await open(); const control = new RustBrowserControl(computer, owner);
  await control.agentClick(0);
  const human = await control.takeover();
  await assert.rejects(control.agentClick(0), /stale/);
  await control.input(human.generation, 0, 0);
  const resumed = await control.resume(human.generation);
  assert.equal(resumed.observation.value, 2);
  assert.equal(owner.current.observation.length, 64);
  await owner.close();
  const recovered = await open();
  assert.equal(recovered.current.mode, 'paused');
  assert.ok(recovered.current.generation > resumed.generation);
  await assert.rejects(recovered.request({ op: 'admit', generation: resumed.generation, actor: 'agent' }), /stale/);
}));

test('exclusive ownership and unfinished action block restart dispatch', async () => fixture(async open => {
  const owner = await open();
  await assert.rejects(open(), /exited/);
  const state = await owner.request({ op: 'admit', generation: 0, actor: 'agent' });
  const exited = new Promise(resolve => owner.process.once('exit', resolve));
  owner.process.kill('SIGKILL'); await exited;
  const recovered = await open();
  assert.equal(recovered.current.uncertain, true);
  assert.equal(recovered.current.pending, state.pending);
  await assert.rejects(recovered.request({ op: 'settle', ticket: state.pending }), /uncertain/);
  await assert.rejects(recovered.request({ op: 'takeover' }), /unavailable/);
}));

test('truncated journal fails closed instead of replaying uncertain actions', async () => fixture(async (open, journal) => {
  const owner = await open(); await owner.close();
  await appendFile(journal, '{"sequence":');
  await assert.rejects(open(), /exited/);
}));

test('durable takeover waits for admitted work and fences queued commands', async () => fixture(async open => {
  const owner = await open(); let release; let began;
  const started = new Promise(resolve => { began = resolve; }); let clicks = 0;
  const control = new RustBrowserControl({ agentClick: async () => { clicks++; began(); await new Promise(resolve => { release = resolve; }); } }, owner);
  const first = control.agentClick(0); await started;
  const queued = assert.rejects(control.agentClick(0), /stale/);
  const takeover = control.takeover();
  // Request ordering establishes the pause fence before settling the active action.
  const state = await owner.request({ op: 'state' }); assert.equal(state.mode, 'pausing');
  release(); await first; await queued;
  assert.equal((await takeover).mode, 'human'); assert.equal(clicks, 1);
}));

test('cancellation during a fresh observation cannot reopen durable dispatch', async () => fixture(async open => {
  const owner = await open(); let release; let began;
  const started = new Promise(resolve => { began = resolve; });
  const control = new RustBrowserControl({ observe: async () => { began(); return new Promise(resolve => { release = resolve; }); } }, owner);
  const human = await control.takeover();
  const resumed = assert.rejects(control.resume(human.generation), /stale/);
  await started;
  const cancelled = control.cancel();
  assert.equal((await owner.request({ op: 'state' })).mode, 'cancelled');
  release({ value: 0 }); await resumed; await cancelled;
  await owner.close();
  const recovered = await open(); assert.equal(recovered.current.mode, 'cancelled');
  await assert.rejects(recovered.request({ op: 'takeover' }), /unavailable/);
}));
