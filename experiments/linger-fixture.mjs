// Deliberately uncooperative descendants for the explicit offline termination probe.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const role = process.argv[2];
if (!['child', 'grandchild'].includes(role)) throw new Error('fixture role required');
process.on('SIGTERM', () => {});
if (role === 'child') spawn(process.execPath, [new URL(import.meta.url).pathname, 'grandchild'], { stdio: 'ignore' });
const beat = () => appendFileSync('/workspace/termination.jsonl', JSON.stringify({ role, pid: process.pid }) + '\n');
beat(); setInterval(beat, 30);
