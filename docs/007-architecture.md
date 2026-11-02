# 007 Architecture

The application retains a ports-and-adapters structure. The domain core has no provider or HTTP imports. Engine is the single writer of triggers, threads, decisions, tickets and assignments; synchronous transactions enqueue external Effects, which run after commit.

Runtime is a plain composition root. It builds Store, Setup, SourceRegistry, Settings, Prompts, Sessions, MasterAssessor, CodexExecutor, Outbox and Passes using explicit dependencies. The Node entry owns the loopback HTTP server and lifecycle. React consumes management views and independent session routes.

AgentRuntime is the provider-independent session interface. CodexRuntime implements it over the pinned Codex CLI app-server protocol. Sessions owns role instructions and application tools, while CodexExecutor translates assignment lifecycle to session activity. Dynamic tool calls are validated against the session’s role and current ticket authorization.

Sources depend on SourceContext rather than Runtime internals. Feishu keeps its event consumer, history polling, cursor state, thread reads, images, policy roster sync and channel adapter. The local panel is another narrow source with an explicit operator identity and a durable reply channel. Neither source owns ticket state transitions.

SQLite preserves the existing aggregate tables, settings revisions, prompt revisions, effects and reply receipts. Additional typed KV families store Codex thread mappings, message delivery state and approval records. Provider state does not replace domain state.

The web panel preserves the existing management pages and adds session conversations, approvals and artifact downloads. Business commands call Engine. Local worker messages are saved as ticket inputs; they do not bypass task state tracking.

Testing combines the retained core, storage, effect, policy and Feishu-read tests with a deterministic stdio app-server fixture. New tests cover protocol messages, duplicate delivery, interrupted sessions, expired approvals and path confinement. Real-account tests are separate operational checks.
