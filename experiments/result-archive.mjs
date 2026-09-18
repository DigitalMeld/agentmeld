// Trusted host archive. Never expose its directory or executable interface to the worker.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { normalizeArguments, validateResult } from './tool-contract.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function command(binary, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH } }, (error, stdout) => error ? reject(new Error('result archive unavailable')) : resolve(stdout));
    // Reads consume no stdin and can exit before the pipe closes on Linux.
    child.stdin.on('error', () => { if (input !== undefined) reject(new Error('result archive input failed')); });
    child.stdin.end(input);
  });
}
function validate(record) {
  if (!record || Object.keys(record).sort().join(',') !== 'action,scope,ticket,value,version' || record.version !== 1 || !Number.isSafeInteger(record.ticket) || record.ticket < 1) throw new Error('invalid archived result');
  const { scope, action } = record;
  scopeDigest(scope);
  if (!action || Object.keys(action).sort().join(',') !== 'arguments,provider,target,tool' || action.provider !== 'codex' || action.target !== scope.worker) throw new Error('invalid result action');
  normalizeArguments(action.tool, action.arguments); validateResult(action.tool, action.arguments, record.value);
  return record;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function scopeDigest(scope) {
  if (!scope || Object.keys(scope).sort().join(',') !== 'request,thread,turn,worker,workspace' || Object.values(scope).some(v => typeof v !== 'string' || !v || !v.isWellFormed() || Buffer.byteLength(v) > 256)) throw new Error('invalid result scope');
  return digest(JSON.stringify(Object.fromEntries(['workspace', 'worker', 'thread', 'turn', 'request'].map(key => [key, scope[key]]))));
}
export function resultBinding(record) {
  validate(record);
  return { ticket: record.ticket, action_digest: actionDigest(record.action), scope_digest: scopeDigest(record.scope) };
}
export const actionDigest = action => digest(canonical(action));
export class ResultArchive {
  constructor(binary, directory) { this.binary = binary; this.directory = directory; }
  async put({ scope, action, ticket, value }) {
    const bytes = JSON.stringify(validate({ version: 1, scope, action, ticket, value }));
    if (Buffer.byteLength(bytes) > 512 * 1024) throw new Error('result archive size limit');
    const receipt = JSON.parse(await command(this.binary, ['artifact-put', this.directory], bytes));
    if (receipt.sha256 !== digest(bytes) || receipt.bytes !== Buffer.byteLength(bytes)) throw new Error('invalid archive receipt');
    return receipt;
  }
  async readSettled(authority, expected) {
    const scope = structuredClone(expected);
    const expectedDigest = scopeDigest(scope);
    const state = await authority.request({ op: 'state' });
    const entry = state.results.find(item => item.scope_digest === expectedDigest);
    if (!entry) throw new Error('no settled result for scope');
    const record = await this.read(entry.result, scope);
    if (record.ticket !== entry.ticket || resultBinding(record).action_digest !== entry.action_digest) throw new Error('settled result binding mismatch');
    return record;
  }
  async read(receipt, expected) {
    if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0 || receipt.bytes > 512 * 1024) throw new Error('invalid archive receipt');
    const bytes = await command(this.binary, ['artifact-get', this.directory, receipt.sha256]);
    if (digest(bytes) !== receipt.sha256 || Buffer.byteLength(bytes) !== receipt.bytes) throw new Error('archive integrity mismatch');
    const record = validate(JSON.parse(bytes));
    if (!expected || Object.keys(record.scope).some(key => record.scope[key] !== expected[key])) throw new Error('archive scope mismatch');
    return record;
  }
  async readReviewed(authority, expected) {
    const scope = structuredClone(expected); const key = scopeDigest(scope);
    const state = await authority.request({ op: 'state' });
    const entry = state.resolutions.find(item => item.scope_digest === key);
    if (!entry || entry.outcome !== 'accept_output') throw new Error('no reviewed output for scope');
    const record = await this.read(entry.result, scope);
    if (record.ticket !== entry.ticket || resultBinding(record).action_digest !== entry.action_digest) throw new Error('reviewed result binding mismatch');
    return { record, review: { id: entry.review_id, reviewer: entry.reviewer, outcome: entry.outcome } };
  }
}
