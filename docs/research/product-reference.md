# AgentMeld product reference research

Research date: 2026-09-17. Purpose: inform a new product specification, not claim feature parity or reproduce proprietary implementation. Public documentation is vendor-described behavior; the signed-in inspection below establishes visible UI only. No agent tasks, purchases, invitations, credential changes, or connector setup were performed.

## Muse: documented capabilities

| Area | Evidence | Implication for AgentMeld |
| --- | --- | --- |
| Personal agent | [Help center](https://www.meta.com/help/artificial-intelligence/1303670544995562/) describes ongoing conversations, tasks, reminders, and connected services. | Persistent agent identity and task history belong in the core product. |
| Browser | [Browser help](https://www.meta.com/help/artificial-intelligence/2124746764949121/) describes a shared user/agent browser, observation, takeover, stop, persistent credentials, and approval controls. | A visible computer and reliable human takeover are first-class features. |
| Connections | [Connectors](https://www.meta.com/en-gb/help/artificial-intelligence/1687253048996149/) covers authorization, disconnect, read-only access, proactive updates, and custom connections. Disconnect does not erase previously retained conversation information. | Connection grants, retained data, and deletion need separate controls. |
| Approvals | [Guidance and approval](https://www.meta.com/help/artificial-intelligence/1385290430137537/) describes connector/web defaults, per-resource permissions, and approvals scoped to an action, task, site, or connector. | Show scope explicitly; authorization should be structured state rather than conversational memory. |
| Identity and memory | [Customization](https://www.meta.com/help/artificial-intelligence/995796179982326/) covers name, appearance, style, durable preferences, file-based memory, and importing prior assistant conversations. | Users need understandable, editable memory with provenance and a reviewed import flow. |
| Scheduled work | [Reminders](https://www.meta.com/help/artificial-intelligence/1484325780075655/) documents one-time, recurring, and location-based reminders, timezone handling, and the Upcoming surface. | Build persistent scheduling; defer location triggers until device clients exist. |
| Skills | [Skills](https://www.meta.com/en-gb/help/artificial-intelligence/2797651547267109/) describes built-in research, document, image, audio, dashboard, and browsing abilities, with suggestions in Ideas. | Separate reusable instructions from executable tool capabilities and model requirements. |
| Artifacts | [Artifacts](https://www.meta.com/en-gb/help/artificial-intelligence/2074655449783957/) describes upload, creation, editing, library persistence, documents, spreadsheets, images, code, and interactive web outputs. | Output must be durable and inspectable outside chat; active HTML needs a separate trust boundary. |
| Data controls | [Data management](https://www.meta.com/help/artificial-intelligence/2225571704857152/) covers conversations, goals, files, reminders, reset, and a model-training preference. | Define export, deletion, retained history, and training consent independently. |
| Payments | [Payments](https://www.meta.com/help/artificial-intelligence/1436362127544482/) describes supervised purchases and protected payment handling. | Keep transaction completion outside the first release; do not build card storage into AgentMeld. |
| Business calls | [Non-user information](https://www.meta.com/help/artificial-intelligence/4532990443643263/) describes experimental outbound business calls. | Calls are a later integration, not a baseline text-agent capability. |

## Muse: signed-in Chrome observation

Inspected the existing Chrome session at `https://muse.ai/`, Library, Goals, Ideas, Feed, and the General, Permissions, Messaging channels, and Connectors settings surfaces. Chat and Library received visual screenshot inspection. Personal transcripts, identity values, account details, and connection status are intentionally not reproduced in these notes. Private screenshots were not saved into the project.

- The chat screen uses a narrow icon rail, broad conversational area, bottom composer, and optional right inspector. The inspector exposes Activity, Approvals, Upcoming, and Identity. The chat picker distinguishes the main chat and side chats.
- Navigation exposes Chat, Search, Feed, Ideas, Goals, and Library. Library groups Documents and Web artifacts separately from Images, Videos, Podcasts, and System files. Search and sort are contextual.
- The design uses dark neutral surfaces, fine dividers, modest rounding, restrained selected states, and large quiet areas. The agent accent can be avatar-derived or selected in settings; light, dark, and system appearance options exist.
- Goals offers category-based entry and a side-by-side chat control. Ideas presents task suggestions grouped by purpose. Neither surface was used to create work.
- Feed exposes an editable generation prompt, editions, and a way to discuss entries in chat. Generation was not invoked.
- Settings separates General, Connectors, Wallet, Secure store, Permissions, Messaging channels, Devices, Data controls, Help, and Legal. Secure store and wallet contents were not opened.
- Permissions exposes connector defaults, web defaults, resource-specific grants, direct-network permissions, and advanced network settings. Messaging channels lists WhatsApp in the observed account. These observations are not a claim about availability for every user.
- The connector catalog includes Google and Microsoft productivity tools alongside other services. Catalog visibility does not establish working authorization or end-to-end connector reliability.

The Invite control was visible, but its meaning and permissions were not tested. Do not infer shared-agent access from its label. AgentMeld collaboration requirements come from Brad's request.

## Grok Bot: documented product model

[Overview](https://docs.x.ai/grok-bot/overview) describes named, persistent agents with background execution and accumulated context. [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps) makes the trust boundary explicit: an account's agents share one computer, files, browser sessions, and CLI credentials. Separate screens are work surfaces, not security boundaries. AgentMeld should preserve persistence while making sharing explicit at the workspace and computer level.

[Messaging and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration) documents groups, mentions, in-progress steering, threaded replies, and asynchronous handoffs. Adopt visible ownership and bounded handoffs; avoid uncontrolled agent conversation loops.

[Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) separates reusable instructions from scheduled/event-triggered execution and describes demonstration-derived draft skills. Adopt that distinction and require review before activating imported or generated automation.

[Approvals and security](https://docs.x.ai/grok-bot/approvals-security-and-privacy) describes action review, policy precedence, human takeover, and model-based auto-review limitations. AgentMeld should enforce capability boundaries in code and treat semantic action review as an additional, imperfect control. Sharing an agent configuration must remain distinct from granting access to a running agent or computer.

## Deliberate product differences

These are AgentMeld design recommendations, not claims about the references:

1. Free self-hosting with a useful default installation and no required commercial connector catalog.
2. Runtime isolation includes the agent process and tools, not just a remote desktop attached to a host process.
3. Separate harness, model provider, and computer provider interfaces; no assumption that Ollama is a complete agent harness.
4. Private-by-default computers and grants; explicit shared workspaces for invited people and agents.
5. Inspectable memory, portable artifacts, and optional training contributions. No automatic use of customer work to train a future model.
6. Rust for orchestration and policy, with mature browser and provider integration components where they reduce maintenance.

## Additional reference: Instinct infrastructure observations

Brad supplied [The box an agent runs in](https://rohanadwankar.github.io/posts/platforms.html#instinct). The author reports first-hand observations of an Instinct sandbox: rented E2B execution, Markdown/Git memory persisted separately, and leased browsers with separately retained identity. These are dated observations and interpretations, not verified vendor architecture guarantees. The article does not establish Instinct's iMessage transport.

Design takeaway: treat working compute, memory, and browser identity as separate lifecycles. Consider portable Markdown projections of approved memory, while keeping authorization outside agent-editable files. Credential expiry cannot undo earlier data exposure, and Git history complicates complete deletion; do not copy those inferred properties into product guarantees. AgentMeld's channel design is researched independently in [iMessage transport](imessage.md).

## Evidence limits

This is a product and source review, not a security audit or runtime benchmark. Muse's documentation and signed-in surfaces can change or vary by account. Computer takeover, scheduled execution, output generation, connector operations, and sharing were not executed. The reference-project and runtime reports provide pinned code findings and integration constraints separately.
