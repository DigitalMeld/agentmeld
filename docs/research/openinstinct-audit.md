# OpenInstinct architecture audit


Scope update: [Apple-first alpha decision](../decisions/2026-09-18-apple-first-alpha.md) defers messaging and transport selection until after alpha. Earlier M0/M2 channel recommendations below are retained as research history, not current release gates.

Date: 2026-09-18. Source revision: `b8b4799336620abf72d79bab3db115a155812373`.

## Scope and conclusion

Read-only source audit of the public repository: deployment, agent/channel composition, browser tools and credential autofill, identity scoping, workstream memory, scheduled execution/reporting, dependency patches, and test/evaluation design. Compared with AgentMeld's product specification, architecture and roadmap. No dependencies installed, upstream tests executed, services deployed, accounts connected, or messages sent. This is an architecture assessment, not a comprehensive security audit or runtime certification.

OpenInstinct is a useful behavioral reference, not a replacement foundation for AgentMeld. Keep our Rust control service, SQLite-first storage, isolated native harnesses, separate browser service, and adapter boundaries. Provider scope was subsequently narrowed to Codex subscription authentication for alpha; Claude Code and Ollama are deferred. Adopt the concrete contracts below without introducing Vercel, Eve, Kernel or Linq as core dependencies. Source inspection establishes implementation intent and code paths; it does not prove reliability, tenant isolation, performance or commercial availability.

## Findings and decisions

### 1. Separate useful product patterns from the managed deployment stack

The documented deployment provisions Kernel browsers, Neon Postgres, private Vercel Blob, Linq and Vercel AI Gateway. Eve coordinates agent execution, and Next.js supplies the web application. Production memory depends on Blob while local development uses process-local memory. This is self-hosting in the user's cloud account, with managed service usage costs. [README.md](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/README.md) [package.json](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/package.json)

**Decision:** retain one Rust control service and explicit storage/runtime adapters. A cloud browser is not evidence that native Claude/Codex subprocesses are isolated. Keep local setup and paid hosted setup distinct, with separate capability and health reports. Do not import OpenInstinct's deployment procedure or cloud services into the free self-host baseline.

### 2. Make specialist assignments and results explicit

The root delegates a bounded assignment with supplied context to a browser worker. The worker declares structured completion with status, message and up to four image artifact descriptors. Shell execution is disabled in its browser-worker tool file. Its semantic browser tools check worker scope and browser ownership and bound execution/output. [agent/instructions/content/worker-coordination.md](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/instructions/content/worker-coordination.md) [agent/subagents/browser-agent/lib/completion.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/lib/completion.ts) [agent/subagents/browser-agent/tools/bash.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/tools/bash.ts) [agent/subagents/browser-agent/tools/semantic_browser.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/tools/semantic_browser.ts)

**Decision:** add a typed browser assignment/result contract before broad UI or agent fan-out. Include objective, permitted references, grants, deadline, budget and computer lease generation. Results distinguish completed, blocked, cancelled, failed and uncertain; carry evidence/artifact references and an explicit input request. A worker's success string is not verified evidence. The trusted service validates scope and referenced records. One worker is enough for M1; collaborative fan-out remains M3.

**Limit:** OpenInstinct's browser worker explicitly selects `meta/muse-spark-1.3`, while its root resolves a configured gateway model. Its broad model-choice positioning does not establish every role is replaceable. AgentMeld must freeze a qualified model/harness choice for each role; no hidden cloud fallback for Ollama. [agent/agent.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/agent.ts) [agent/subagents/browser-agent/agent.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/agent.ts)

### 3. Keep execution, reporting and transport receipts separate

Scheduled jobs have their own run leases and a separate report lease/status lifecycle. Reporting can recover independently of task execution. Linq reports use a stable run/sequence idempotency key; replies resolve within the current conversation. These are useful patterns for preventing repeated work when a notification fails. [db/services/scheduled-agent-jobs.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/db/services/scheduled-agent-jobs.ts) [agent/lib/schedules/report-lifecycle.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/lib/schedules/report-lifecycle.ts) [agent/lib/reply-targets.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/lib/reply-targets.ts) [agent/channels/linq.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/channels/linq.ts)

**Decision:** persist a notification intent referencing the committed result and original authorized channel binding. Report recovery must never rerun completed tools. Apply durable outbox/idempotency handling to interactive and scheduled replies, including chunks and attachments. Recheck destination grants before delivery; a missing reply anchor may fall back only within the same authorized chat after definite rejection, not after ambiguous submission.

**Limit:** the inspected Linq path finalizes a report as `delivered` after the send call returns. This is not proof of recipient delivery. Preserve separate submitted, confirmed-sent and delivered states based on actual receipts. Scheduled idempotency in this file does not prove every interactive send is durably deduplicated.

### 4. Treat channel authentication as an integration contract

Linq ingress rejects bot messages and unlinked/unverified phone identities. It maps verified users into application scope. Its verifier explicitly translates an unsuccessful OIDC result from `null` to `false` because the consuming adapter rejects only `false`; regression tests cover missing/malformed forwarder credentials. [agent/channels/linq.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/channels/linq.ts) [tests/agent/channels/linq-inbound-auth.test.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/tests/agent/channels/linq-inbound-auth.test.ts)

**Decision:** fail closed on false, null, missing, malformed, expired and exceptional authentication results at every channel boundary. Transport verification, sender identity and conversation authorization are three separate checks. Do not auto-enroll an unknown sender or use a phone number as the universal principal ID. Keep email-based iMessage identities possible through explicit pairing. Existing personal scope derivation in OpenInstinct is not evidence for AgentMeld's future guest roles. [shared/identity/access-scope.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/shared/identity/access-scope.ts)

OpenInstinct confirms Linq as one implemented managed iMessage path. It does not identify the commercial Instinct service's transport. Qualify BlueBubbles and imsg against the same self-host contract; investigate Linq separately for hosted identity provisioning, privacy, pricing and provider terms. No transport selected by this audit.

### 5. Add bounded work memory with revision checks

OpenInstinct workstreams keep ongoing objectives, constraints, observations and next steps separate from chat. Recall injects a small index and reads the selected record on demand. Writes require expected revisions. Forget clears content/source references and keeps a tombstone to reject stale saves; recall also replaces an old index with an empty one when necessary. Workstream notes are explicitly untrusted and cannot start a job or authorize an action. [agent/memory/workstreams.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/memory/workstreams.ts) [db/services/workstreams.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/db/services/workstreams.ts)

**Decision:** add WorkRecord/WorkRevision to M2 memory, under owner-approved memory policy. Keep bounded summaries with provenance, unresolved steps and task links; retrieve an index then selected records. Test conflicting edits, scope leakage, compaction refresh, empty-index replacement and delayed writes after deletion. Do not copy arbitrary limits as performance claims: size/index/count budgets need local measurements. Forgetting a work record is separate from cancelling a run or deleting transcripts/backups. Lightweight continuity is not a proactive goal engine; the latter remains M4.

### 6. Use opaque credential handles, but qualify every observation path

Vault fill accepts a candidate handle and owned browser ID, derives page origin, materializes claims inside trusted code, and returns metadata rather than secret values. Login use is origin-bound. Screenshot masking targets marked secret elements. [agent/subagents/browser-agent/tools/fill_from_vault.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/tools/fill_from_vault.ts) [agent/subagents/browser-agent/lib/autofill/provider.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/lib/autofill/provider.ts) [agent/subagents/browser-agent/lib/autofill/native.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/lib/autofill/native.ts) [agent/subagents/browser-agent/lib/vault-screenshot-mask.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/agent/subagents/browser-agent/lib/vault-screenshot-mask.ts)

**Decision:** retain protected human login as the initial path. Later credential-fill operations use opaque handles, exact origin/frame checks, owner grants, lease fencing and audit receipts. Before enabling them, test canary exclusion across DOM/text, screenshots, traces, errors and artifacts, plus cross-origin frames, redirects and page mutation between validation and fill. Masking selected fields is not universal protection against page scripts or alternate observation tools. This audit does not establish the README's broad model-secret exclusion claim. Autofill permission must not imply purchase permission; no payment-card vault is added to alpha scope.

### 7. Make package-boundary behavior and evaluations explicit

The repository patches both a direct Linq adapter and the copy bundled by Eve, with a test aimed at the bundled runtime. At this revision package/workspace configuration pins Eve 0.55.0, but the patch README still discusses 0.52.2 and an older immutable build. Source/lockfile agreement matters more than narrative version claims. [pnpm-workspace.yaml](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/pnpm-workspace.yaml) [patches/README.md](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/patches/README.md) [tests/agent/channels/linq-bundled-adapter.test.ts](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/tests/agent/channels/linq-bundled-adapter.test.ts)

Its evaluation plan separates coordinator behavior from slower real-site browser work, and favors deterministic assertions for authorization, routing and secret canaries. Model-judge checks are secondary qualitative signals. [evals/README.md](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/evals/README.md)

**Decision:** test the exact loaded adapter and native protocol version, not just mocks or an adjacent package. No patches copied; upstream-first dependency policy remains. Extend local verification with end-to-end task outcomes and context/token measurements, while keeping paid inference, containers, real sites and messages in explicit opt-in probes. No GitHub-connected CI.

## Plan impact and next work

| Stage | Change | Required evidence |
| --- | --- | --- |
| M0 | Compare Mac transports; test role configuration, verifier failures and loaded adapter boundaries | Capability matrix, failure fixtures, resource measurements; real messaging waits for an authorized identity |
| M1 | Typed browser outcomes and durable result/notification separation | Restart after task completion cannot replay its actions; cancelled/uncertain results are displayed honestly |
| M2 | Work records, notification recovery and same-chat reply anchors | Stale-write/deletion tests, ACL retrieval, failed/unknown sends, attachment/chunk recovery and revocation |
| M2/M4 | Preserve protected human login; qualify any later autofill independently | Canary tests over all observation paths; no new vault or payment requirement for alpha |
| M3 | Keep guest isolation and delegated grant checks | Personal workspace scoping does not substitute for ordinary guest testing |
| M5 | Optional managed iMessage/browser adapters | Terms, costs, account provisioning, export and provider-outage behavior |

The existing M0 blockers still govern progress: actual provider inference/authentication, authenticated owner/task integration and production recovery are not solved by this reference project. These changes sharpen the next implementation contracts; they do not restart M0 or justify more fixture work without a named exit requirement.

## Audit checkpoint

Updated locally: this report, architecture, roadmap, product specification and iMessage research. No runtime implementation or dependency changes. No upstream source copied. OpenInstinct's root source license is MIT; any future reuse needs its own dependency/license review and AgentMeld's pending license decision remains separate. [LICENSE](https://github.com/Merit-Systems/OpenInstinct/blob/b8b4799336620abf72d79bab3db115a155812373/LICENSE)
