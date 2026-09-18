// Read-only reconstruction from trusted host storage. This is not a dispatch grant.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';

function validIdentity(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(value);
}
export function validateWorkerRecord(record) {
  if (!record || Object.keys(record).sort().join(',') !== 'runtimeId,version,worker,workspace'
      || record.version !== 1 || !validIdentity(record.runtimeId)
      || typeof record.worker !== 'string' || !/^[a-f0-9]{64}$/.test(record.worker)
      || typeof record.workspace !== 'string' || !isAbsolute(record.workspace)
      || !record.workspace.isWellFormed() || Buffer.byteLength(record.workspace) > 256
      || /\p{Cc}/u.test(record.workspace)) throw new Error('invalid recovery worker record');
  return structuredClone(record);
}

export async function saveWorkerRecord(path, worker) {
  // Only called after OwnedWorker.bind in trusted host code and before dispatch.
  const record = validateWorkerRecord({ version: 1, runtimeId: await worker.runtime.identity(), worker: worker.id, workspace: worker.workspace });
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); }
  finally { await file.close(); }
  return record;
}

export async function readWorkerRecord(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.uid !== process.getuid() || (meta.mode & 0o077) !== 0 || meta.nlink !== 1 || meta.size > 4096) throw new Error('invalid recovery worker file');
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error('recovery worker file limit');
    return validateWorkerRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))));
  } finally { await file.close(); }
}

export class RecoveryWorker {
  constructor(record, runtime) { this.record = Object.freeze(validateWorkerRecord(record)); this.runtime = runtime; }
  async observeTermination(scope) {
    const { worker, workspace, runtimeId } = this.record;
    if (scope?.worker !== worker || scope?.workspace !== workspace) throw new Error('worker recovery scope mismatch');
    try {
      // Recheck both sides of inventory to reject endpoint changes during lookup.
      if (await this.runtime.identity() !== runtimeId) throw new Error('runtime mismatch');
      const ids = await this.runtime.ids();
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('invalid inventory');
      if (await this.runtime.identity() !== runtimeId) throw new Error('runtime changed');
      return { worker, state: ids.includes(worker) ? 'present' : 'absent' };
    } catch { return { worker, state: 'unavailable' }; }
  }
}
