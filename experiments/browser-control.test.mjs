import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserControl } from './browser-control.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('takeover fences queued input and waits for the active browser action', async () => {
  const active = deferred(); const started = deferred(); let clicks = 0;
  const control = new BrowserControl({ agentClick: async () => { clicks++; started.resolve(); await active.promise; } });
  const first = control.agentClick(0); await started.promise;
  const queued = assert.rejects(control.agentClick(0), /stale/);
  const takeover = control.takeover();
  assert.equal(control.state().mode, 'pausing');
  active.resolve(); await first; await queued;
  assert.equal((await takeover).mode, 'human'); assert.equal(clicks, 1);
});

test('resume supplies a fresh observation and rejects old generations', async () => {
  let value = 0;
  const control = new BrowserControl({ humanClick: async () => { value++; }, observe: async () => ({ value }), agentClick: async () => { value++; } });
  const human = await control.takeover();
  await control.input(human.generation, 1, 1);
  const resumed = await control.resume(human.generation);
  assert.deepEqual(resumed.observation, { value: 1 });
  await assert.rejects(control.agentClick(0), /stale/);
  await assert.rejects(control.input(human.generation, 1, 1), /stale/);
  await control.agentClick(resumed.generation); assert.equal(value, 2);
});

test('disconnect during observation cannot accidentally resume automation', async () => {
  const observation = deferred(); const started = deferred();
  const control = new BrowserControl({ observe: async () => { started.resolve(); return observation.promise; } });
  const human = await control.takeover();
  const resume = assert.rejects(control.resume(human.generation), /stale/);
  await started.promise;
  const disconnect = control.disconnect(); observation.resolve({});
  await resume; await disconnect;
  assert.equal(control.state().mode, 'paused');
  await assert.rejects(control.agentClick(control.generation), /stale/);
});

test('cancel during takeover stays terminal and failed observation stays paused', async () => {
  const control = new BrowserControl({ observe: async () => { throw new Error('capture failed'); } });
  const human = await control.takeover();
  await assert.rejects(control.resume(human.generation), /capture/);
  assert.equal(control.state().mode, 'paused');
  const takeover = assert.rejects(control.takeover(), /stale/);
  await control.cancel(); await takeover;
  await assert.rejects(control.takeover(), /unavailable/);
  assert.equal(control.state().mode, 'cancelled');
});
