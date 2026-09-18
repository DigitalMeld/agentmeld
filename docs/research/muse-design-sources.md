# Muse public design sources

Reviewed: 2026-09-18. First-party sources supplement the [live design baseline](../design/muse-baseline.md). Published descriptions establish design intent, not independently verified behavior. No proprietary assets downloaded or copied into the repository.

## Designer rationale

[How We Designed Muse](https://introducing.muse.ai/) by Mona Sarantakos with Christine Awad, September 2026, is the strongest design reference found. It describes a persistent main conversation with optional side chats, bubbles that separate asynchronous messages, avatar access to activity, explicit approval controls, and artifacts that remain useful outside chat. It also explains selective notifications and contextual suggestions. These principles support keeping AgentMeld conversational while exposing task state and decisions clearly.

Application: preserve the main-chat/side-chat hierarchy and avatar-led inspector. Treat explicit approvals as structured controls. Show artifacts inline and in Library. Make background notifications selective. These are design directions; goals, generated Ideas and broader artifact types retain their existing roadmap stages.

The article links a [product-design walkthrough](https://www.youtube.com/watch?v=wHn0hTjvFoo). The link was discovered, but the full video was not viewed in this pass; no observations are attributed to it.

## Product positioning and platform reference

[Meta's launch announcement](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) describes a messaging-oriented interface, background work and asking for input on consequential actions. Use this as context for the visible experience, not proof of its safety or execution guarantees.

The [Muse from Meta App Store listing](https://apps.apple.com/us/app/muse-from-meta/id6760173601) is the canonical iOS listing located during research. It identifies the relevant product among unrelated apps called Muse. Its screenshot gallery was visually reviewed on 2026-09-18: light-theme conversation, inline approval, browser preview, connectors, Ideas, an inline artifact and populated Goals. See the [mobile reference](../design/muse-mobile-reference.md) for the visual inventory and comparison with 22 user-supplied screenshots. Store descriptions and promotional screenshots do not substitute for physical-device interaction testing.

## Evidence discipline

Live iPhone observations are recorded separately in the design baseline. Exact typography, colors, animation timing and touch-target measurements remain unverified. No public design-system/token specification was established in the reviewed sources. Do not infer the native app's framework from visual similarity or store descriptions.
