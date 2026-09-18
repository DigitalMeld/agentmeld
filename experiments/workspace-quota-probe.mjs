// Explicit disk-limit fixture. It writes and removes only its own synthetic filler.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const budget = 64 * 1024 * 1024;
const stats = fs.statfsSync('/workspace');
const filesystemBytes = stats.blocks * stats.bsize;
assert.ok(filesystemBytes > 32 * 1024 * 1024 && filesystemBytes <= budget);
const marker = '/workspace/retained.txt';
const expected = 'retained-' + process.env.AGENTMELD_QUOTA_INSTANCE;
if (process.env.AGENTMELD_QUOTA_FIRST === '1') {
  const saved = fs.openSync(marker, 'wx', 0o600); fs.writeSync(saved, expected); fs.fsyncSync(saved); fs.closeSync(saved);
  const fd = fs.openSync('/workspace/filler.bin', 'wx', 0o600); const block = Buffer.alloc(1024 * 1024, 0x61);
  let diskFull = false;
  try { for (let i = 0; i < 128; i++) fs.writeSync(fd, block); }
  catch (error) { if (error.code !== 'ENOSPC') throw error; diskFull = true; }
  finally { fs.closeSync(fd); }
  assert.ok(diskFull, 'must hit the filesystem limit before the bounded fixture loop ends');
  const writtenBytes = fs.statSync('/workspace/filler.bin').size; assert.ok(writtenBytes > budget / 2 && writtenBytes <= budget);
  assert.equal(fs.readFileSync(marker, 'utf8'), expected);
  fs.unlinkSync('/workspace/filler.bin');
  const recovered = fs.openSync('/workspace/recovered.txt', 'wx', 0o600); fs.writeSync(recovered, 'writes recovered'); fs.fsyncSync(recovered); fs.closeSync(recovered);
  console.log(JSON.stringify({ phase: 'm0', diskFull, filesystemBytes, writtenBytes, existingFilePreserved: true, writesRecoverAfterRemoval: true }));
} else {
  assert.equal(fs.readFileSync(marker, 'utf8'), expected);
  assert.equal(fs.readFileSync('/workspace/recovered.txt', 'utf8'), 'writes recovered');
  console.log(JSON.stringify({ phase: 'm0', filesystemBytes, replacementReadback: true }));
}
