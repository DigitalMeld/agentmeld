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
  const resolution = state.resolutions.find(entry => entry.ticket === request.ticket && entry.scope_digest === scope);
  const pending = state.pending === request.ticket && state.pending_scope === scope;
  if (!settled && !pending && !resolution) throw new Error('no matching recovery action');
  let status;
  let verifiedReceipt = null;
  if (resolution?.outcome === 'close_unknown') {
    status = 'closed_unknown';
  } else if (settled || resolution || (state.dispatched && request.receipt)) {
    const receipt = settled ? settled.result : resolution ? resolution.result : request.receipt;
    try {
      const record = await archive.read(receipt, request.scope);
      const binding = resultBinding(record);
      if (binding.ticket !== request.ticket || binding.scope_digest !== scope || binding.action_digest !== (settled ? settled.action_digest : resolution ? resolution.action_digest : state.pending_digest)) throw new Error('binding mismatch');
      verifiedReceipt = { ...receipt };
      status = settled ? 'settled_verified' : resolution ? 'reviewed_output_verified' : 'pending_output_verified';
    } catch {
      status = settled ? 'settled_output_unavailable' : resolution ? 'reviewed_output_unavailable' : 'pending_output_unavailable';
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
    version: 3, sequence: state.sequence, generation: state.generation,
    mode: state.mode, ticket: request.ticket, status,
    actionDigest: settled?.action_digest ?? resolution?.action_digest ?? state.pending_digest,
    settlementRecorded: Boolean(settled), verifiedReceipt,
    reviewRecorded: resolution ? { id: resolution.review_id, reviewer: resolution.reviewer, outcome: resolution.outcome } : null,
    workerState,
    requiresWorkerReconciliation: pending && state.dispatched && workerState !== 'absent',
    requiresOutcomeReview: !settled && !resolution,
    retryAuthorized: false, resumeAuthorized: false,
  };
}
