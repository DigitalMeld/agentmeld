import { execFile } from 'node:child_process';
import { normalizeArguments, validateResult } from './tool-contract.mjs';
function rustSum(binary, args, signal) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, ['replay', 'ollama'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: { PATH: process.env.PATH }, signal }, (error, stdout) => {
      if (error) return reject(new Error('Rust sum execution failed or interrupted'));
      try { resolve(validateResult('fixture_sum', args, JSON.parse(stdout).tool_results[0])); } catch { reject(new Error('invalid Rust sum result')); }
    });
    child.stdin.on('error', () => reject(new Error('Rust tool input failed')));
    child.stdin.end(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'sum', arguments: args } }] }, done: true }) + '\n');
  });
}
// Trusted synthetic reviewer only. Real approvals need an authenticated owner interface.
export function durableSum({ authority, binary, scope, allow, stats }) {
  let sequence = 0;
  return async (call, signal) => {
    signal?.throwIfAborted();
    if (call.name !== 'sum') throw new Error('ungranted tool');
    const args = normalizeArguments('fixture_sum', call.arguments);
    const action = { provider: 'ollama', tool: 'fixture_sum', target: scope.worker, arguments: args };
    const requestScope = { ...scope, request: String(++sequence) };
    try {
      const proposal = await authority.request({ op: 'propose', generation: authority.current.generation, action, scope: requestScope, ttl_ms: 30000 });
      const decision = await authority.request({ op: 'decide', approval_id: proposal.approval.id, action, scope: requestScope, allow });
      if (decision.decision !== 'allow') throw new Error('fixture approval denied');
      signal?.throwIfAborted();
      await authority.request({ op: 'dispatch', actor: 'agent', generation: decision.generation, ticket: decision.pending, action });
      stats.executions++;
      const result = await rustSum(binary, args, signal);
      await authority.request({ op: 'settle', ticket: decision.pending, action });
      stats.results.push(result.sum);
      return result;
    } catch (error) {
      await authority.request({ op: 'disconnect' }).catch(() => {});
      throw error;
    }
  };
}
