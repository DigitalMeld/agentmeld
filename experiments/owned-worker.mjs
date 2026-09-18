// Local runtime identity. The host's dedicated Docker transport and cidfile are trusted.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { toolSchemas } from './tool-contract.mjs';
const execute = promisify(execFile);
export function dockerRuntime(context) {
  const run = async args => (await execute('docker', ['--context', context, ...args], { timeout: 15000, maxBuffer: 1024 * 1024 })).stdout;
  return {
    identity: async () => (await run(['info', '--format', '{{.ID}}'])).trim(),
    inspect: async id => JSON.parse(await run(['inspect', id]))[0],
    stop: async id => { await run(['stop', '--time', '1', id]); },
    ids: async () => (await run(['ps', '-a', '--no-trunc', '--format', '{{.ID}}'])).trim().split('\n').filter(Boolean),
  };
}
export class OwnedWorker {
  static async bind({ id, image, workspace, computer, runtime, tools = [] }) {
    if (!/^[a-f0-9]{64}$/.test(id) || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('immutable runtime identity required');
    const actual = await runtime.inspect(id);
    if (actual.Id !== id || actual.Image !== image || !actual.State?.Running || actual.Config?.User !== '1000:1000' || actual.Config?.Labels?.['io.digitalmeld.agentmeld.phase'] !== 'm0' || actual.HostConfig?.NetworkMode !== 'none' || actual.HostConfig?.Privileged !== false || actual.HostConfig?.ReadonlyRootfs !== true || actual.Mounts?.length !== 1 || actual.Mounts[0].Type !== 'bind' || actual.Mounts[0].Destination !== '/workspace' || actual.Mounts[0].Source !== workspace) throw new Error('worker runtime binding mismatch');
    const limits = actual.HostConfig;
    const security = limits.SecurityOpt;
    if (limits.Memory !== 1073741824 || limits.NanoCpus !== 1000000000 || limits.PidsLimit !== 256 || limits.Init !== true || !Array.isArray(limits.CapDrop) || limits.CapDrop.length !== 1 || limits.CapDrop[0] !== 'ALL' || (limits.CapAdd != null && (!Array.isArray(limits.CapAdd) || limits.CapAdd.length !== 0)) || !Array.isArray(security) || !security.some(value => value === 'no-new-privileges:true' || value === 'no-new-privileges') || security.some(value => /^(seccomp|apparmor)[=:]unconfined$/.test(value)) || (limits.PidMode ?? '') !== '' || (limits.IpcMode !== 'private' && limits.IpcMode !== '') || (limits.Devices?.length ?? 0) !== 0 || (limits.DeviceRequests?.length ?? 0) !== 0) throw new Error('worker runtime limits mismatch');
    if (!Array.isArray(tools) || tools.some(tool => !Object.hasOwn(toolSchemas, tool))) throw new Error('unsupported grant');
    return new OwnedWorker(id, workspace, computer, runtime, tools);
  }
  constructor(id, workspace, computer, runtime, tools) { this.id = id; this.workspace = workspace; this.computer = computer; this.runtime = runtime; this.tools = new Set(tools); this.revoked = false; this.termination = 'running'; this.stopping = null; }
  authorize(tool, scope) {
    if (this.revoked || this.computer.dead || !this.tools.has(tool) || scope.worker !== this.id || scope.workspace !== this.workspace) throw new Error('worker scope or grant denied');
  }
  async request(tool, args) {
    this.authorize(tool, { worker: this.id, workspace: this.workspace });
    return this.computer.request(tool, args);
  }
  async observeTermination(scope) {
    if (scope?.worker !== this.id || scope?.workspace !== this.workspace) throw new Error('worker recovery scope mismatch');
    try {
      const ids = await this.runtime.ids();
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('invalid runtime inventory');
      return { worker: this.id, state: ids.includes(this.id) ? 'present' : 'absent' };
    } catch {
      return { worker: this.id, state: 'unavailable' };
    }
  }
  async terminate() {
    this.revoked = true;
    if (this.stopping) return this.stopping;
    const previouslyStopped = this.termination === 'stopped';
    this.termination = 'unconfirmed';
    this.stopping = (async () => {
      let stopError;
      if (!previouslyStopped) try { await this.runtime.stop(this.id); } catch (error) { stopError = error; }
      // A successful inventory is required even when stop reports an already-removed container.
      const evidence = await this.observeTermination({ worker: this.id, workspace: this.workspace });
      if (evidence.state === 'unavailable') throw new Error('worker inventory unavailable');
      if (evidence.state !== 'absent') throw stopError || new Error('worker still present');
      this.termination = 'stopped';
      this.computer.fail(new Error('worker stopped'));
      return { termination: 'stopped', worker: this.id };
    })();
    try { return await this.stopping; } finally { this.stopping = null; }
  }
}
