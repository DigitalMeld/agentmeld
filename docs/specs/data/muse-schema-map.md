# Muse schema disposition: all exposed relations

Updated 2026-09-18. Planning decisions, not claims of implemented equivalents. Source: the catalog identified in the [bundle manifest](../../research/muse-documentation-manifest.json). All 195 relation names are accounted for exactly once. This is a feature/ownership mapping, not SQL translation or an import of Muse data.

**Adapt:** retain the responsibility with independently designed records. **Consolidate:** cover it through fewer existing core concepts or a derived projection. **Defer:** retain named coverage for a later milestone. **Omit:** no direct equivalent is needed; reason recorded. A source field name is not proof of its semantics. Core DDL lives in [core-schema.sql](core-schema.sql); domain extensions in the [data model](../data-model.md#planned-domain-extensions-not-missing-core-tables).

Disposition counts: Adapt 28, Consolidate 43, Defer 118, Omit 6.

## activity

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `activity.activity_monitor_agent_threads` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |
| `activity.activity_monitor_carrier_user_messages` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |
| `activity.activity_monitor_message_threads` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |
| `activity.activity_monitor_runtime_work_threads` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |
| `activity.activity_monitor_thread_actions` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |
| `activity.activity_monitor_thread_sections` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |
| `activity.activity_monitor_threads` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |
| `activity.feed_entries` | Consolidate | run_events + runs/tool_steps/artifact projections | M1c | One recorded execution history; do not duplicate a second activity state machine |

## agent

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `agent.agent_ancestors` | Defer | run ancestry, narrowed grants and handoff/mailbox records | M3 | No fan-out schema before bounded delegation is enabled |
| `agent.agent_compactions` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |
| `agent.agent_message_token_usage` | Consolidate | run usage snapshots and usage events | M1/M2 | Provider metrics may be unavailable; never fabricate zero cost |
| `agent.agents` | Consolidate | agents, provider_sessions, runs/events and fenced workspace leases | M1a/M1e | Keep persona, native session and execution identity distinct; reconcile actual worker |
| `agent.chat_preferences` | Adapt | conversation/agent preference revisions | M2 | UI preferences do not grant tool authority |
| `agent.compactions` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |
| `agent.context_item_derived_write_backlog` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |
| `agent.context_item_fields` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |
| `agent.context_item_resume_projection` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |
| `agent.context_items` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |
| `agent.context_text_segments` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |
| `agent.message_mailbox` | Defer | run ancestry, narrowed grants and handoff/mailbox records | M3 | No fan-out schema before bounded delegation is enabled |
| `agent.recovery_owner_terminal_events` | Consolidate | agents, provider_sessions, runs/events and fenced workspace leases | M1a/M1e | Keep persona, native session and execution identity distinct; reconcile actual worker |
| `agent.recovery_owners` | Consolidate | agents, provider_sessions, runs/events and fenced workspace leases | M1a/M1e | Keep persona, native session and execution identity distinct; reconcile actual worker |
| `agent.runtime_restart_checkpoints` | Consolidate | agents, provider_sessions, runs/events and fenced workspace leases | M1a/M1e | Keep persona, native session and execution identity distinct; reconcile actual worker |
| `agent.runtime_state` | Consolidate | agents, provider_sessions, runs/events and fenced workspace leases | M1a/M1e | Keep persona, native session and execution identity distinct; reconcile actual worker |
| `agent.session_memory_capture_deadlines` | Defer | maintenance admission/claim records | M4 opt-in | Do not enable background memory writes by copying a timer |
| `agent.session_metadata` | Consolidate | agents, provider_sessions, runs/events and fenced workspace leases | M1a/M1e | Keep persona, native session and execution identity distinct; reconcile actual worker |
| `agent.sessions` | Consolidate | agents, provider_sessions, runs/events and fenced workspace leases | M1a/M1e | Keep persona, native session and execution identity distinct; reconcile actual worker |
| `agent.subagent_monitor_decisions` | Defer | run ancestry, narrowed grants and handoff/mailbox records | M3 | No fan-out schema before bounded delegation is enabled |
| `agent.subagent_progress` | Defer | run ancestry, narrowed grants and handoff/mailbox records | M3 | No fan-out schema before bounded delegation is enabled |
| `agent.subagent_progress_message_events` | Defer | run ancestry, narrowed grants and handoff/mailbox records | M3 | No fan-out schema before bounded delegation is enabled |
| `agent.subagent_progress_tool_events` | Defer | run ancestry, narrowed grants and handoff/mailbox records | M3 | No fan-out schema before bounded delegation is enabled |
| `agent.subagent_spawns` | Defer | run ancestry, narrowed grants and handoff/mailbox records | M3 | No fan-out schema before bounded delegation is enabled |
| `agent.token_usage` | Consolidate | run usage snapshots and usage events | M1/M2 | Provider metrics may be unavailable; never fabricate zero cost |
| `agent.volatile_context_pins` | Consolidate | provider-owned context plus authorized context-source manifests | M1 continuation/M2 retrieval | Do not reproduce hidden reasoning or native compaction internals |

## device

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `device.calendar_events` | Defer | capability-specific device data projections | M4 | Pairing alone does not authorize contact/calendar/call-history ingestion |
| `device.call_log` | Defer | capability-specific device data projections | M4 | Pairing alone does not authorize contact/calendar/call-history ingestion |
| `device.client_contexts` | Adapt | device identities, capabilities, grants and sync cursors | M2 P8 | Separate client rendering from host command permissions |
| `device.contact_addresses` | Defer | capability-specific device data projections | M4 | Pairing alone does not authorize contact/calendar/call-history ingestion |
| `device.contact_emails` | Defer | capability-specific device data projections | M4 | Pairing alone does not authorize contact/calendar/call-history ingestion |
| `device.contact_phones` | Defer | capability-specific device data projections | M4 | Pairing alone does not authorize contact/calendar/call-history ingestion |
| `device.contacts` | Defer | capability-specific device data projections | M4 | Pairing alone does not authorize contact/calendar/call-history ingestion |
| `device.data_sync_state` | Adapt | device identities, capabilities, grants and sync cursors | M2 P8 | Separate client rendering from host command permissions |
| `device.media_upload_batches` | Defer | bounded resumable upload records | M2 as needed | Simple uploads first; qualify interrupted large transfers before adding protocol |
| `device.media_upload_events` | Defer | bounded resumable upload records | M2 as needed | Simple uploads first; qualify interrupted large transfers before adding protocol |
| `device.nodes` | Adapt | device identities, capabilities, grants and sync cursors | M2 P8 | Separate client rendering from host command permissions |
| `device.upload_chunks` | Defer | bounded resumable upload records | M2 as needed | Simple uploads first; qualify interrupted large transfers before adding protocol |
| `device.upload_sessions` | Defer | bounded resumable upload records | M2 as needed | Simple uploads first; qualify interrupted large transfers before adding protocol |

## feed

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `feed.fleet_engagement_contributions` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.fleet_engagement_outbox` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.fleet_fetch_receipts` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.fleet_publish_state` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.fleet_reaction_outbox` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.interactions` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.null_state_seed` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.preferences_projection` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.prompt_scope_verdict` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.prompt_seed` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.promptless_unit_orders` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.prompts` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.run_steps` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.runs` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.surface_state` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `feed.units` | Defer | feed domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |

## goals

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `goals.actions` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.associations` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.briefings` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.engagement_events` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.goals` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.learning_state` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.momentum_history` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.sessions` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.suggestions` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.thread_actions` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.threads` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `goals.updates` | Defer | goals domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |

## health

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `health.aggregates` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `health.events` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `health.record_values` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `health.sample_values` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `health.samples` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `health.sleep_sessions` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `health.synced_ranges` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `health.workouts` | Defer | health records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |

## ideas

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `ideas.bandit_arm_state` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.bandit_fold_state` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.bandit_folded_events` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.discovery_pool_history` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.discovery_pool_meta` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.explore_policy` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.feed_snapshot_cards` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.feed_snapshot_sections` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.feed_snapshots` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.icon_embeddings` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_anchors` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_build_status` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_card_feeds` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_dedup` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_events` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_feedback_state` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_install_assets` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_items` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_quality` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_sources` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.idea_tags` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |
| `ideas.ideas` | Defer | ideas domain records linked to conversations/runs | M4 | Implement product behavior; do not copy proprietary ranking or inference from names |

## ingest

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `ingest.data_source_events` | Defer | authenticated trigger occurrence ledger | M2/M4 | Add when connector/event source is selected; deduplicate before run admission |

## media

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `media.descriptions` | Defer | media records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `media.exif_values` | Defer | media records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `media.items` | Defer | media records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `media.locations` | Defer | media records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |

## memory

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `memory.claims` | Adapt | memory entries/revisions, claims and source references | M2 | Owner-approved memory with correction, supersession and tombstones |
| `memory.embedding_models` | Defer | optional derived retrieval index | After M2 evaluation | Use full-text retrieval first; add vectors only with measured benefit |
| `memory.embeddings` | Defer | optional derived retrieval index | After M2 evaluation | Use full-text retrieval first; add vectors only with measured benefit |
| `memory.entries` | Adapt | memory entries/revisions, claims and source references | M2 | Owner-approved memory with correction, supersession and tombstones |
| `memory.entry_attributes` | Adapt | memory entries/revisions, claims and source references | M2 | Owner-approved memory with correction, supersession and tombstones |
| `memory.metadata` | Adapt | memory entries/revisions, claims and source references | M2 | Owner-approved memory with correction, supersession and tombstones |

## messages

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `messages.native` | Omit | canonical messages plus future channel bindings | M1/M4 | No legacy Muse-native compatibility surface to maintain |

## podcasts

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `podcasts.episodes` | Defer | podcasts records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `podcasts.feed` | Defer | podcasts records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |
| `podcasts.feeds` | Defer | podcasts records and scoped blob references | M4 | Separate capability, consent, retention and provider qualification |

## runtime

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `runtime.agent_todo_snapshots` | Consolidate | context-source manifests, work records and visible summaries | M2 | Derived summaries retain source revisions and cannot authorize execution |
| `runtime.avatar_state` | Adapt | agent identity revision and selected asset reference | M2 | Original user-authorized assets; no Muse branding |
| `runtime.browser_tasks` | Adapt | browser assignments linked to run, lease, grants and outcome | M1d | No separate always-running browser coordinator required |
| `runtime.channel_deliveries` | Defer | channel bindings and delivery receipts | M4 | Messaging remains post-alpha; reuse existing run/outbox authority |
| `runtime.channel_message_bindings` | Defer | channel bindings and delivery receipts | M4 | Messaging remains post-alpha; reuse existing run/outbox authority |
| `runtime.chat_event_derived_write_backlog` | Consolidate | run_events, typed payloads and fenced leases | M1 | Durable ordered evidence and rebuildable projections |
| `runtime.checkout_spend_checkpoints` | Defer | protected purchase intents/approval/receipts | M4 | No payment vault or provider selected for alpha |
| `runtime.checkout_spend_operations` | Defer | protected purchase intents/approval/receipts | M4 | No payment vault or provider selected for alpha |
| `runtime.client_rendering_capabilities` | Adapt | client capability manifest | M2 | Unsupported rendering cannot be advertised as available |
| `runtime.context_snapshots` | Consolidate | context-source manifests, work records and visible summaries | M2 | Derived summaries retain source revisions and cannot authorize execution |
| `runtime.dev_notice_watermark` | Omit | no direct equivalent | None | Muse legacy/rollout presentation state is not a product requirement |
| `runtime.event_channels` | Consolidate | run_events, typed payloads and fenced leases | M1 | Durable ordered evidence and rebuildable projections |
| `runtime.event_hook_space_owners` | Defer | scoped trigger/artifact ownership | M4 | Recheck owner grants at dispatch |
| `runtime.event_payload_fields` | Consolidate | run_events, typed payloads and fenced leases | M1 | Durable ordered evidence and rebuildable projections |
| `runtime.events` | Consolidate | run_events, typed payloads and fenced leases | M1 | Durable ordered evidence and rebuildable projections |
| `runtime.execute_resolve_runs` | Consolidate | runs, request keys, origin messages and later run ancestry | M1/M3 | One user request/run initially; explicit children only when delegation ships |
| `runtime.idea_execution_pending` | Defer | idea acceptance linked to idempotent run admission | M4 | An idea card is not execution |
| `runtime.invite_badge_seen_state` | Omit | no direct equivalent | None | Muse legacy/rollout presentation state is not a product requirement |
| `runtime.maintenance_markers` | Defer | opt-in maintenance inputs and privacy preferences | M4/M5 | Minimize retention; product use does not imply training consent |
| `runtime.message_attachments` | Adapt | messages and message_attachments | M1a | Stable visible history and scoped byte references |
| `runtime.message_reactions` | Defer | message reactions | After core M2 chat | Not required to fix conversation continuity |
| `runtime.messages` | Adapt | messages and message_attachments | M1a | Stable visible history and scoped byte references |
| `runtime.product_improvements_preference` | Defer | opt-in maintenance inputs and privacy preferences | M4/M5 | Minimize retention; product use does not imply training consent |
| `runtime.raw_signal_collections` | Defer | opt-in maintenance inputs and privacy preferences | M4/M5 | Minimize retention; product use does not imply training consent |
| `runtime.raw_signal_entries` | Defer | opt-in maintenance inputs and privacy preferences | M4/M5 | Minimize retention; product use does not imply training consent |
| `runtime.requests` | Consolidate | runs, request keys, origin messages and later run ancestry | M1/M3 | One user request/run initially; explicit children only when delegation ships |
| `runtime.resources` | Consolidate | tool_steps, recorded events and bounded blobs | M1c | Exact call/result correlation; missing events stay unknown |
| `runtime.search_documents` | Adapt | derived scoped full-text index | M2 | Exclude hidden traffic and remove deleted content |
| `runtime.skill_invalidation_state` | Adapt | skill version/hash and invalidation records | M2 | Skill edits do not grant capabilities |
| `runtime.stripe_link_spend_requests` | Defer | protected purchase intents/approval/receipts | M4 | No payment vault or provider selected for alpha |
| `runtime.summaries` | Consolidate | context-source manifests, work records and visible summaries | M2 | Derived summaries retain source revisions and cannot authorize execution |
| `runtime.tool_calls` | Consolidate | tool_steps, recorded events and bounded blobs | M1c | Exact call/result correlation; missing events stay unknown |
| `runtime.tool_outputs` | Consolidate | tool_steps, recorded events and bounded blobs | M1c | Exact call/result correlation; missing events stay unknown |
| `runtime.widgets` | Defer | versioned typed presentation blocks | M2/M4 | No arbitrary active code on the application origin |
| `runtime.work_items` | Consolidate | runs, request keys, origin messages and later run ancestry | M1/M3 | One user request/run initially; explicit children only when delegation ships |
| `runtime.workflow_agent_calls` | Consolidate | runs, request keys, origin messages and later run ancestry | M1/M3 | One user request/run initially; explicit children only when delegation ships |
| `runtime.workflow_launch_occurrence_aliases` | Omit | no direct equivalent | None | Muse legacy/rollout presentation state is not a product requirement |
| `runtime.workflow_legacy_launch_occurrence_blocks` | Omit | no direct equivalent | None | Muse legacy/rollout presentation state is not a product requirement |
| `runtime.workflow_phase_runs` | Consolidate | runs, request keys, origin messages and later run ancestry | M1/M3 | One user request/run initially; explicit children only when delegation ships |
| `runtime.workflow_runs` | Consolidate | runs, request keys, origin messages and later run ancestry | M1/M3 | One user request/run initially; explicit children only when delegation ships |
| `runtime.writer_epoch` | Consolidate | run_events, typed payloads and fenced leases | M1 | Durable ordered evidence and rebuildable projections |

## scheduler

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `scheduler.cron_mutations` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.delivery_outbox` | Adapt | delivery_outbox | M1e/M2 | Result completion is independent from notification receipt |
| `scheduler.doctor_run_plans` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.doctor_task_state` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.events` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.job_definitions` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.job_idea_scope` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.job_runs` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.jobs` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.scheduled_resume_registrations` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.scheduled_resume_state` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |
| `scheduler.terminal_signals` | Adapt | schedule definitions, occurrences, runs and recovery records | M2 | Versioned schedules; run links, durable deduplication and missed-run policy |

## self_improvement

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `self_improvement.backfill_day_runs` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.calculation_records` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.calibration_records` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.connector_read_audit` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.conversation_follow_up_attempts` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.handoff_dedupe` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.learning_adoption_events` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.leases` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.objective_markers` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.objective_state` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.relationship_briefs` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |
| `self_improvement.runs` | Defer | maintenance runs/proposals, leases and adoption history | M4 opt-in | Changed-input and budget admission; no automatic model retraining |

## shell

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `shell.user_state` | Consolidate | versioned owner/agent preferences | M2 | No generic agent-writable authority bucket |

## spaces

| Source relation | Decision | AgentMeld destination | Milestone | Rationale |
| --- | --- | --- | --- | --- |
| `spaces.action_arguments` | Defer | artifact builds, isolated app state and static shares | M4 | Private active content and publication require separate authority |
| `spaces.action_invocations` | Defer | artifact builds, isolated app state and static shares | M4 | Private active content and publication require separate authority |
| `spaces.action_results` | Defer | artifact builds, isolated app state and static shares | M4 | Private active content and publication require separate authority |
| `spaces.backfill_markers` | Omit | versioned migrations/import receipts when needed | M1 | No inherited Muse backfill history |
| `spaces.file_artifact_identities` | Adapt | artifacts + artifact_versions | M1b | Stable identity independent from slug/path |
| `spaces.proposals` | Defer | artifact builds, isolated app state and static shares | M4 | Private active content and publication require separate authority |
| `spaces.shares` | Defer | artifact builds, isolated app state and static shares | M4 | Private active content and publication require separate authority |
| `spaces.spaces` | Defer | artifact builds, isolated app state and static shares | M4 | Private active content and publication require separate authority |
| `spaces.user_state` | Defer | artifact builds, isolated app state and static shares | M4 | Private active content and publication require separate authority |
