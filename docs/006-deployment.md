# 006 Deployment

Install and run the standalone Node service following [SETUP](../SETUP.md). The production server serves both the compiled React panel and management API on a loopback listener. No DSH plugin manager or GitHub account is involved.

Startup configuration includes stateDir, port, codexPath, promptMaxChars, admissionContextMaxPages and admissionContextTimeoutMs. It is validated with Zod. Business settings and prompt versions remain in SQLite. Account-changing source edits restart Runtime; ordinary policy and execution settings take effect through the existing settings flow.

The state directory contains orchestrator.sqlite, task directories, worker command shims, and local routing state. Codex retains its own thread history under the logged-in account’s Codex storage. Back up both stores while the service is stopped if full recovery is required. Old DSH databases are rejected.

The bot CLI must use strict bot identity. Source errors appear in the management panel. Missing Codex login or an incompatible CLI version leaves the panel available for diagnostics. Install the supported version rather than bypassing compatibility checks.

Worker command shims route lark-cli to the selected bot and preserve blocked command defaults. Shims and prompts are operational guardrails, not an OS security boundary. Codex sandbox permissions and local-panel approvals control additional execution access.

Stop using SIGTERM or Ctrl-C. The service stops intake and agent processes before closing storage and releasing the state lock. A restart expires approvals and marks interrupted execution for review.

Web bot onboarding stores isolated CLI configuration under `stateDir/feishu-bots/bot-*`; native CLI secret storage remains responsible for credentials. Each generated wrapper clears inherited identity and profile overrides. The worker shim invokes the selected wrapper. Keep that directory and the CLI credential store with the service account. Checks are read-only bot-info requests; saving verifies before switching the versioned source setting and does not widen existing receiving scopes or Policy authorization.
