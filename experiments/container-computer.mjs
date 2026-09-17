// Host-side bounded request/response transport. Container output never becomes a supervisor command.
import { spawn } from 'node:child_process';
export class ContainerComputer {
  constructor(command, args, onFailure = () => {}) {
    this.process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map(); this.next = 0; this.buffer = Buffer.alloc(0); this.dead = false;
    this.fail = error => {
      if (this.dead) return;
      this.dead = true;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear(); this.process.kill('SIGKILL'); if (!this.closing) onFailure();
    };
    this.process.on('error', this.fail);
    this.process.on('exit', () => this.fail(new Error('computer disconnected')));
    this.process.stdin.on('error', this.fail);
    this.process.stderr.resume();
    this.process.stdout.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > 2 * 1024 * 1024) return this.fail(new Error('computer output limit'));
      let end;
      while ((end = this.buffer.indexOf(10)) >= 0) {
        const line = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
        let frame;
        try { frame = JSON.parse(line); } catch { return this.fail(new Error('invalid computer response')); }
        if (!frame || typeof frame !== 'object' || Object.keys(frame).some(key => !['id', 'result', 'error'].includes(key)) || !Number.isSafeInteger(frame.id) || !this.pending.has(frame.id)) return this.fail(new Error('unsolicited computer response'));
        const waiter = this.pending.get(frame.id); this.pending.delete(frame.id); clearTimeout(waiter.timer);
        if (frame.error) waiter.reject(new Error('computer rejected operation'));
        else waiter.resolve(frame.result);
      }
    });
  }
  request(op, args = {}) {
    if (this.dead) return Promise.reject(new Error('computer unavailable'));
    if (this.pending.size >= 4) return Promise.reject(new Error('computer queue full'));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => this.fail(new Error('computer timeout')), 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify({ id, op, args }) + '\n');
    });
  }
  async agentClick() { const value = await this.request('agent_click'); if (value?.completed !== true) throw new Error('invalid action receipt'); }
  async humanClick(x, y) { const value = await this.request('human_click', { x, y }); if (value?.completed !== true) throw new Error('invalid action receipt'); }
  async observe() {
    const value = await this.request('observe');
    if (!value || typeof value.counter !== 'string' || !/^\d{1,6}$/.test(value.counter) || typeof value.png !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(value.png) || value.png.length > 1024 * 1024) throw new Error('invalid observation');
    const png = Buffer.from(value.png, 'base64');
    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.subarray(12, 16).toString() !== 'IHDR' || png.readUInt32BE(16) !== 640 || png.readUInt32BE(20) !== 360) throw new Error('invalid observation dimensions');
    return { counter: value.counter, png: value.png };
  }
  async close() {
    this.closing = true;
    if (this.process.exitCode !== null || this.process.signalCode) return;
    const exited = new Promise(resolve => this.process.once('exit', resolve));
    this.process.stdin.end();
    const timer = setTimeout(() => this.process.kill('SIGKILL'), 2000);
    await exited; clearTimeout(timer);
  }
}
