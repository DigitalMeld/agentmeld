// M0 in-process browser experiment, not the durable Rust worker supervisor.
export class BrowserControl {
  constructor(computer) {
    this.computer = computer;
    this.mode = 'agent';
    this.generation = 0;
    this.tail = Promise.resolve();
    this.queued = 0;
  }
  state() { return { mode: this.mode, generation: this.generation }; }
  enqueue(operation) {
    if (this.queued >= 32) return Promise.reject(new Error('queue full'));
    this.queued++;
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {}).finally(() => { this.queued--; });
    return result;
  }
  require(mode, generation) {
    if (this.mode !== mode || this.generation !== generation) throw new Error('stale controller');
  }
  agentClick(generation) {
    return this.enqueue(async () => {
      this.require('agent', generation);
      await this.computer.agentClick();
    });
  }
  takeover() {
    if (!['agent', 'paused'].includes(this.mode)) return Promise.reject(new Error('takeover unavailable'));
    this.mode = 'pausing';
    const generation = ++this.generation; // Fence queued agent input before awaiting active work.
    return this.enqueue(() => {
      this.require('pausing', generation);
      this.mode = 'human';
      return this.state();
    });
  }
  input(generation, x, y) {
    return this.enqueue(async () => {
      this.require('human', generation);
      await this.computer.humanClick(x, y);
      return this.state();
    });
  }
  frame() {
    return this.enqueue(async () => {
      if (!['agent', 'human', 'paused'].includes(this.mode)) throw new Error('frame unavailable');
      return this.computer.observe();
    });
  }
  resume(generation) {
    try { this.require('human', generation); } catch (error) { return Promise.reject(error); }
    this.mode = 'resuming';
    const next = ++this.generation;
    return this.enqueue(async () => {
      this.require('resuming', next);
      const observation = await this.computer.observe();
      this.require('resuming', next); // Cancellation/disconnect while observing cannot reopen dispatch.
      this.mode = 'agent';
      return { ...this.state(), observation };
    }).catch(error => {
      if (this.mode === 'resuming' && this.generation === next) this.mode = 'paused';
      throw error;
    });
  }
  disconnect() {
    if (this.mode === 'cancelled') return Promise.resolve(this.state());
    this.mode = 'paused';
    const generation = ++this.generation;
    return this.enqueue(() => {
      this.require('paused', generation);
      return this.state();
    });
  }
  cancel() {
    this.mode = 'cancelled';
    ++this.generation;
    return this.enqueue(() => this.state());
  }
}
