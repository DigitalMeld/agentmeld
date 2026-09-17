#!/usr/bin/env node
// Explicitly acquires an existing journal; opening appends its normal recovery snapshot.
import { parseArgs } from 'node:util';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RustAuthority } from '../experiments/rust-browser-control.mjs';
import { ResultArchive } from '../experiments/result-archive.mjs';
import { assessRecovery, validateRecoveryRequest } from '../experiments/recovery-assessment.mjs';

let owner;
try {
  const { values } = parseArgs({ options: { journal: { type: 'string' }, archive: { type: 'string' }, request: { type: 'string' }, recover: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node scripts/review-recovery.mjs --recover --journal PATH --archive DIRECTORY --request JSON_FILE\nAcquires an existing journal exclusively and appends its normal paused recovery snapshot (cancelled stays cancelled). Checks one scope/ticket and optional receipt. Never executes, settles, resumes or stops a worker.');
  } else {
    if (!values.recover || !values.journal || !values.archive || !values.request) throw new Error('arguments required');
    const file = await open(values.request, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let request;
    try {
      const meta = await file.stat();
      if (!meta.isFile() || meta.size > 65536) throw new Error('invalid request file');
      const buffer = Buffer.alloc(65537);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 65536) throw new Error('request limit');
      request = validateRecoveryRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))));
    } finally { await file.close(); }
    const journal = await lstat(values.journal);
    const archive = await lstat(values.archive);
    if (!journal.isFile() || journal.isSymbolicLink() || journal.size === 0 || !archive.isDirectory() || archive.isSymbolicLink()) throw new Error('existing recovery storage required');
    const binary = fileURLToPath(new URL('../target/debug/agentmeld-m0', import.meta.url));
    owner = await RustAuthority.open(binary, values.journal);
    console.log(JSON.stringify(await assessRecovery(owner, new ResultArchive(binary, values.archive), request)));
  }
} catch {
  console.error('Recovery assessment unavailable. Check arguments, existing storage and exclusive ownership; preserve evidence. Use --help for usage.');
  process.exitCode = 1;
} finally { await owner?.close(); }
