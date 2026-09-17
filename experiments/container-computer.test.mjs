import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContainerComputer } from './container-computer.mjs';

test('container-originated control requests are rejected rather than forwarded', async () => {
  const computer = new ContainerComputer(process.execPath, ['-e', `process.stdin.once('data',()=>console.log(JSON.stringify({id:1,op:'cancel',result:{completed:true}})))`]);
  try { await assert.rejects(computer.agentClick(), /unsolicited/); assert.equal(computer.dead, true); }
  finally { await computer.close(); }
});

test('unmatched receipts and oversized output close the computer transport', async () => {
  for (const payload of ['JSON.stringify({id:999,result:{completed:true}})', "'x'.repeat(3*1024*1024)"]) {
    const computer = new ContainerComputer(process.execPath, ['-e', `process.stdin.once('data',()=>process.stdout.write(${payload}+'\\n'))`]);
    try { await assert.rejects(computer.agentClick(), /response|limit|disconnected/); assert.equal(computer.dead, true); }
    finally { await computer.close(); }
  }
});

test('invalid observation data never reaches the viewer', async () => {
  const computer = new ContainerComputer(process.execPath, ['-e', `process.stdin.once('data',()=>console.log(JSON.stringify({id:1,result:{counter:'3',png:'<script>'}})))`]);
  try { await assert.rejects(computer.observe(), /invalid observation/); }
  finally { await computer.close(); }
});


test('large declared screenshot dimensions are rejected before viewer delivery', async () => {
  const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12); png.writeUInt32BE(100000, 16); png.writeUInt32BE(360, 20);
  const result = JSON.stringify({ id: 1, result: { counter: '3', png: png.toString('base64') } });
  const computer = new ContainerComputer(process.execPath, ['-e', `process.stdin.once('data',()=>console.log(${JSON.stringify(result)}))`]);
  try { await assert.rejects(computer.observe(), /dimensions/); } finally { await computer.close(); }
});
