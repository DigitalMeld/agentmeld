// Trusted M0 worker bridge. Rust owns durable admission; this queue owns browser I/O.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export class RustAuthority {
  static async open(binary, journal, onFailure = () => {}) {
    const authority = new RustAuthority(binary, journal, onFailure);
    await authority.ready;
    return authority;
  }
  constructor(binary, journal, onFailure) {
    this.pending = []; this.buffer = ''; this.dead = false; this.current = null;
    this.process = spawn(binary, ['supervise', journal], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
    this.ready = new Promise((resolve, reject) => { this.initial = { resolve, reject }; });
    this.fail = error => {
      if (this.dead) return;
      this.dead = true; this.initial?.reject(error); this.initial = null;
      for (const item of this.pending.splice(0)) { clearTimeout(item.timer); item.reject(error); }
      this.process.kill('SIGKILL'); if (!this.closing) onFailure();
    };
    const startup = setTimeout(() => this.fail(new Error('supervisor startup timeout')), 5000);
    this.ready.then(() => clearTimeout(startup), () => clearTimeout(startup));
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', () => this.fail(new Error('supervisor exited')));
    this.process.stdin.on('error', error => this.fail(error));
    this.process.stderr.resume(); // Never relay subprocess diagnostics into the model/UI.
    this.process.stdout.on('data', chunk => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 65536) return this.fail(new Error('supervisor output limit'));
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        let value;
        try { value = JSON.parse(line); } catch { return this.fail(new Error('invalid supervisor response')); }
        const waiter = this.initial || this.pending.shift();
        if (!waiter) return this.fail(new Error('unsolicited supervisor response'));
        this.initial = null; clearTimeout(waiter.timer);
        if (value.ok) { this.current = value.ok; waiter.resolve(value.ok); }
        else { waiter.reject(new Error(value.error || 'supervisor rejected operation')); }
      }
    });
  }
  request(command) {
    if (this.dead) return Promise.reject(new Error('supervisor unavailable'));
    if (this.pending.length >= 32) return Promise.reject(new Error('supervisor queue full'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('supervisor response timeout')), 5000);
      this.pending.push({ resolve, reject, timer });
      this.process.stdin.write(JSON.stringify(command) + '\n');
    });
  }
  async close() {
    this.closing = true;
    if (this.process.exitCode !== null || this.process.signalCode) return;
    const exited = new Promise(resolve => this.process.once('exit', resolve));
    this.process.stdin.end();
    const timer = setTimeout(() => this.process.kill('SIGKILL'), 1000);
    await exited; clearTimeout(timer);
  }
}

export class RustBrowserControl {
  constructor(computer, authority) { this.computer = computer; this.authority = authority; this.tail = Promise.resolve(); this.queued = 0; }
  get generation() { return this.authority.current.generation; }
  state() { const { mode, generation, private: hidden } = this.authority.current; return { mode: this.authority.dead ? 'unavailable' : mode, generation, private: hidden }; }
  enqueue(fn) {
    if (this.queued >= 32) return Promise.reject(new Error('queue full'));
    this.queued++;
    const operation = this.tail.then(fn);
    this.tail = operation.catch(() => {}).finally(() => { this.queued--; });
    return operation;
  }
  action(actor, generation, action, execute) {
    return this.enqueue(async () => {
      const admission = await this.authority.request({ op: 'admit', actor, generation, action });
      await this.authority.request({ op: 'dispatch', actor, generation, ticket: admission.pending, action });
      // A thrown or interrupted action has an uncertain outcome. Leave its ticket pending.
      try { await execute(); }
      catch (error) { await this.authority.request({ op: 'disconnect' }); throw error; }
      await this.authority.request({ op: 'settle', ticket: admission.pending, action });
      return this.state();
    });
  }
  agentClick(generation) { return this.action('agent', generation, { tool: 'browser.fixture_increment', target: 'fixture', arguments: {} }, () => this.computer.agentClick()); }
  input(generation, x, y) { return this.action('human', generation, { tool: 'browser.click', target: 'fixture', arguments: { x, y } }, () => this.computer.humanClick(x, y)); }
  async takeover() {
    const state = await this.authority.request({ op: 'takeover' });
    return this.enqueue(async () => {
      await this.authority.request({ op: 'human_ready', generation: state.generation });
      return this.state();
    });
  }
  frame() {
    return this.enqueue(async () => {
      const state = await this.authority.request({ op: 'state' });
      if (state.private || !['agent', 'human', 'paused'].includes(state.mode)) throw new Error('frame unavailable');
      const observation = await this.computer.observe();
      const current = await this.authority.request({ op: 'state' });
      if (current.private || current.generation !== state.generation) throw new Error('frame revoked');
      return observation;
    });
  }
  async privacy(generation, hidden) {
    await this.authority.request({ op: hidden ? 'private_begin' : 'private_end', generation });
    return this.enqueue(() => this.state());
  }
  async resume(generation) {
    const next = await this.authority.request({ op: 'resume', generation });
    return this.enqueue(async () => {
      try {
        const observation = await this.computer.observe();
        const digest = createHash('sha256').update(JSON.stringify(observation)).digest('hex');
        await this.authority.request({ op: 'observed', generation: next.generation, digest });
        return { ...this.state(), observation };
      } catch (error) {
        if (this.state().mode === 'resuming') await this.authority.request({ op: 'disconnect' });
        throw error;
      }
    });
  }
  async disconnect() { await this.authority.request({ op: 'disconnect' }); return this.enqueue(() => this.state()); }
  async cancel() { await this.authority.request({ op: 'cancel' }); return this.enqueue(() => this.state()); }
}
