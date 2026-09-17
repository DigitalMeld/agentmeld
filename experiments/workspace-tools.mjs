import { opendir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeArguments, validateResult, textLimit } from './tool-contract.mjs';
export async function listWorkspace(root) {
  const entries = [];
  for await (const entry of await opendir(root)) {
    if (entries.length >= 128) throw new Error('workspace listing limit');
    entries.push(entry.name);
  }
  return validateResult('workspace_list', {}, { entries: entries.sort() });
}

// root is the trusted, fixed workspace mount. No caller-selected parent directory.
export async function readWorkspace(root, args) {
  const { name } = normalizeArguments('workspace_read', args);
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) throw new Error('safe file open unavailable');
  const file = await open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(textLimit)) throw new Error('workspace file type or size rejected');
    const buffer = Buffer.alloc(textLimit + 1); let bytes = 0;
    while (bytes < buffer.length) {
      const read = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (bytes > textLimit || BigInt(bytes) !== before.size || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].some(key => before[key] !== after[key])) throw new Error('workspace file changed or exceeded limit');
    const content = buffer.subarray(0, bytes);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
    return validateResult('workspace_read', { name }, { name, text, bytes, sha256: createHash('sha256').update(content).digest('hex') });
  } finally { await file.close(); }
}
