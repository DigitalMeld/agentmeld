// Trusted host review interface. Never pass it to a worker or provider callback.
import { randomBytes } from 'node:crypto';
import { assessRecovery, validateRecoveryRequest } from './recovery-assessment.mjs';
import { actionDigest } from './result-archive.mjs';
import { normalizeArguments } from './tool-contract.mjs';

function validatePlan(plan) {
  if (!plan || Object.keys(plan).sort().join(',') !== 'action,generation,outcome,request,review_id,reviewer,sequence,version' || plan.version !== 1
      || !Number.isSafeInteger(plan.sequence) || plan.sequence < 1 || !Number.isSafeInteger(plan.generation) || plan.generation < 1
      || typeof plan.review_id !== 'string' || !/^[a-f0-9]{64}$/.test(plan.review_id)
      || typeof plan.reviewer !== 'string' || !plan.reviewer.trim() || !plan.reviewer.isWellFormed() || Buffer.byteLength(plan.reviewer) > 128 || /\p{Cc}/u.test(plan.reviewer)
      || !['accept_output', 'close_unknown'].includes(plan.outcome)
      || !plan.action || Object.keys(plan.action).sort().join(',') !== 'arguments,provider,target,tool' || plan.action.provider !== 'codex' || plan.action.target !== plan.request?.scope?.worker) throw new Error('invalid recovery review');
  normalizeArguments(plan.action.tool, plan.action.arguments);
  const request = validateRecoveryRequest(plan.request);
  if (!/^[a-f0-9]{64}$/.test(request.scope.worker) || (plan.outcome === 'accept_output') !== Object.hasOwn(request, 'receipt')) throw new Error('invalid recovery review evidence');
  return structuredClone(plan);
}
function requireReviewable(report, outcome, action) {
  if (!report.status.startsWith('pending_') || report.status === 'pending_not_dispatched' || report.workerState !== 'absent'
      || (outcome === 'accept_output' && report.status !== 'pending_output_verified')) throw new Error('recovery evidence does not permit this review');
  if (report.actionDigest !== actionDigest(action)) throw new Error('review action binding mismatch');
}
export async function prepareRecoveryReview(authority, archive, worker, { request, action, outcome, reviewer }) {
  const selected = validateRecoveryRequest(request);
  if (outcome === 'close_unknown') delete selected.receipt;
  // Validate all operator input before querying any runtime.
  const plan = validatePlan({ version: 1, review_id: randomBytes(32).toString('hex'), reviewer, sequence: 1, generation: 1, request: selected, action, outcome });
  const report = await assessRecovery(authority, archive, selected, worker);
  requireReviewable(report, outcome, plan.action);
  plan.sequence = report.sequence; plan.generation = report.generation;
  return plan;
}
export async function commitRecoveryReview(authority, archive, worker, reviewedPlan) {
  const plan = validatePlan(reviewedPlan);
  const report = await assessRecovery(authority, archive, plan.request, worker);
  requireReviewable(report, plan.outcome, plan.action);
  if (report.sequence !== plan.sequence || report.generation !== plan.generation) throw new Error('review is stale; prepare and review again');
  // Rust compares sequence/generation again when committing. A lost acknowledgement is not retried.
  return authority.request({ op: 'reconcile', sequence: plan.sequence, generation: plan.generation,
    ticket: plan.request.ticket, action: plan.action, scope: plan.request.scope,
    review_id: plan.review_id, reviewer: plan.reviewer, outcome: plan.outcome,
    worker_absent: true, result: plan.request.receipt ?? null });
}
