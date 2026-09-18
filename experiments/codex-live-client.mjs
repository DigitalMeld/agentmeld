// Bounded, fail-closed native protocol client for explicit live qualification only.
export class LiveClient {
  constructor(proc, timeout = 60000) {
    this.proc = proc; this.pending = new Map(); this.events = []; this.waiters = new Set();
    this.deniedCallbacks = 0; this.sequence = 0; this.buffer = ''; this.bytes = 0; this.closing = false;
    this.timer = setTimeout(() => this.fail(), timeout);
    proc.on('error', () => this.fail()); proc.on('exit', () => this.fail());
    proc.stdin.on('error', () => this.fail()); proc.stderr.resume();
    proc.stdout.on('data', chunk => {
      this.bytes += chunk.length; this.buffer += chunk.toString();
      if (this.bytes > 8 * 1024 * 1024 || Buffer.byteLength(this.buffer) > 1024 * 1024) return this.fail();
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try { this.frame(JSON.parse(line)); } catch { this.fail(); return; }
      }
    });
  }
  fail() {
    if (this.closing || this.failed) return;
    this.failed = true; clearTimeout(this.timer);
    for (const p of this.pending.values()) p.reject(Error('native probe unavailable'));
    for (const w of this.waiters) w.reject(Error('native probe unavailable'));
    this.pending.clear(); this.waiters.clear(); this.proc.kill('SIGKILL');
  }
  send(frame) { this.proc.stdin.write(JSON.stringify(frame) + '\n'); }
  frame(frame) {
    if (this.failed) return;
    if (frame.method && frame.id !== undefined) {
      this.deniedCallbacks++;
      // This probe grants no escalation, permissions, or dynamic tool callback.
      this.send({ id: frame.id, error: { code: -32601, message: 'Live qualification does not grant escalation' } });
      return;
    }
    const p = this.pending.get(frame.id);
    if (p) { this.pending.delete(frame.id); if (frame.error) p.reject(Object.assign(Error('native rejected probe request'), { rpcCode: frame.error.code, experimentalRequired: /experimental/i.test(frame.error.message ?? '') })); else p.resolve(frame.result); return; }
    if (!frame.method) return;
    if (this.events.length >= 4096) return this.fail();
    this.events.push(frame);
    for (const w of this.waiters) if (w.match(frame)) { this.waiters.delete(w); w.resolve(frame); }
  }
  request(method, params) {
    if (this.failed || this.closing) return Promise.reject(Error('native probe unavailable'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence; this.pending.set(id, { resolve, reject }); this.send({ id, method, params });
    });
  }
  wait(match) {
    if (this.failed || this.closing) return Promise.reject(Error('native probe unavailable'));
    const found = this.events.find(match); if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => this.waiters.add({ match, resolve, reject }));
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'agentmeld_m0_live', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
  }
  async turn(threadId, text) {
    const offset = this.events.length;
    const started = await this.request('turn/start', { threadId, effort: 'low', input: [{ type: 'text', text, text_elements: [] }] });
    const turnId = started.turn.id;
    if (turnId === this.lastTurnId) throw Object.assign(Error('native reused completed turn'), { reusedTurn: true });
    this.lastTurnId = turnId;
    const result = await this.wait(f => f.method === 'turn/completed' && f.params?.threadId === threadId && f.params?.turn?.id === turnId);
    const events = this.events.filter(f => f.params?.threadId === threadId && f.params?.turnId === turnId);
    const items = events.filter(f => f.method === 'item/completed').map(f => f.params.item);
    const answer = items.filter(i => i.type === 'agentMessage').map(i => i.text).join('');
    const knownTypes = new Set(['userMessage','agentMessage','functionCallOutput','plan','reasoning','commandExecution','fileChange','mcpToolCall','dynamicToolCall']);
    this.lastDiagnostic = { methods: [...new Set(this.events.slice(offset).map(f => f.method))].filter(m => /^(codex\/event\/[a-z_]+|item\/[a-zA-Z/]+|turn\/[a-zA-Z/]+|thread\/[a-zA-Z/]+)$/.test(m)).slice(0,40), itemTypes: items.map(i => knownTypes.has(i.type) ? i.type : 'other'), completedTypes: (result.params.turn.items ?? []).map(i => knownTypes.has(i.type) ? i.type : 'other'), itemCount: items.length, freshCommandCount: this.events.slice(offset).filter(f => f.params?.item?.type === 'commandExecution').length, responseMentionsExit: answer.includes('23') };
    return { status: result.params.turn.status, items, answer, streamed: events.some(f => f.method === 'item/agentMessage/delta') };
  }
  async close() {
    clearTimeout(this.timer); this.closing = true;
    for (const p of this.pending.values()) p.reject(Error('native probe closed'));
    for (const w of this.waiters) w.reject(Error('native probe closed'));
    this.pending.clear(); this.waiters.clear();
    const exited = new Promise(resolve => { if (this.proc.exitCode !== null || this.proc.signalCode) resolve(); else this.proc.once('exit', resolve); });
    this.proc.stdin.end(); this.proc.kill('SIGTERM');
    const kill = setTimeout(() => this.proc.kill('SIGKILL'), 1000); await exited; clearTimeout(kill);
  }
}
