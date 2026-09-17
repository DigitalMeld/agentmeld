import { opendir } from 'node:fs/promises';
import { validateResult } from './tool-contract.mjs';
export async function listWorkspace(root) {
  const entries = [];
  for await (const entry of await opendir(root)) {
    if (entries.length >= 128) throw new Error('workspace listing limit');
    entries.push(entry.name);
  }
  return validateResult('workspace_list', {}, { entries: entries.sort() });
}
