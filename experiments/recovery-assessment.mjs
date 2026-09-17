// Trusted host evidence review. Never dispatches, settles, resumes, or stops a worker.
import { scopeDigest, resultBinding } from './result-archive.mjs';

export function validateRecoveryRequest(request) {
  if (!request || !['scope,ticket', 'receipt,scope,ticket'].includes(Object.keys(request).sort().join(',')) || !Number.isSafeInteger(request.ticket) || request.ticket < 1) throw new Error('invalid recovery request');
  scopeDigest(request.scope);
  if (Object.hasOwn(request, 'receipt')) {
    const r = request.receipt;
    if (!r || Object.keys(r).sort().join(',') !== 'bytes,sha256' || typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes < 1 || r.bytes > 524288) throw new Error('invalid recovery receipt');
  }
  return structuredClone(request);
}

export async function assessRecovery(authority, archive, input, worker = null) {
  const request = validateRecoveryRequest(input);
  const scope = scopeDigest(request.scope);
  const state = await authority.request({ op: 'state' });
  if (!['paused', 'cancelled'].includes(state.mode)) throw new Error('recovery requires a paused or cancelled supervisor');
  const settled = state.results.find(entry => entry.ticket === request.ticket && entry.scope_digest === scope);
  const pending = state.pending === request.ticket && state.pending_scope === scope;
  if (!settled && !pending) throw new Error('no matching recovery action');
  let status;
  let verifiedReceipt = null;
  if (settled || (state.dispatched && request.receipt)) {
    const receipt = settled ? settled.result : request.receipt;
    try {
      const record = await archive.read(receipt, request.scope);
      const binding = resultBinding(record);
      if (binding.ticket !== request.ticket || binding.scope_digest !== scope || binding.action_digest !== (settled ? settled.action_digest : state.pending_digest)) throw new Error('binding mismatch');
      verifiedReceipt = { ...receipt };
      status = settled ? 'settled_verified' : 'pending_output_verified';
    } catch {
      status = settled ? 'settled_output_unavailable' : 'pending_output_unavailable';
    }
  } else {
    status = state.dispatched ? 'pending_outcome_unknown' : 'pending_not_dispatched';
  }
  let workerState = 'not_checked';
  if (worker) {
    const evidence = await worker.observeTermination(request.scope);
    if (evidence?.worker !== request.scope.worker || !['present', 'absent', 'unavailable'].includes(evidence.state)) throw new Error('invalid worker evidence');
    workerState = evidence.state;
  }
  // Do not report evidence against a state that changed during storage/runtime reads.
  const current = await authority.request({ op: 'state' });
  if (current.sequence !== state.sequence || current.generation !== state.generation) throw new Error('recovery state changed; assess again');
  return {
    version: 2, sequence: state.sequence, generation: state.generation,
    mode: state.mode, ticket: request.ticket, status,
    settlementRecorded: Boolean(settled), verifiedReceipt,
    workerState,
    requiresWorkerReconciliation: !settled && state.dispatched && workerState !== 'absent',
    requiresOutcomeReview: !settled,
    retryAuthorized: false, resumeAuthorized: false,
  };
}
