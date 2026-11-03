# Feishu Superagent

A standalone Node.js work assistant, with a React management panel, Feishu intake through `lark-cli`, and persistent Codex CLI worker sessions. Research prototype: review and adapt it before using it with your team.

The guiding principle remains: **take as little human attention as possible, and give as much value as possible**. Explicit requests and written rules authorize work. Routine progress stays internal; results and questions return to the original conversation.

## Start

Requirements: macOS or Linux, Node.js 22.19+, Codex CLI **0.166.0** (also supports **0.153.4**), and a bot-only `lark-cli` configuration for Feishu. No DSH, GitHub CLI, or Git repository is required.

```sh
npm install
npm run build
codex login
npm start
```

Open the loopback address printed by the service (default `http://127.0.0.1:4317`). The management panel remains available when CLI setup is incomplete. In Settings → Sources, use “Connect a Feishu bot” to enter the CLI executable, App ID and App Secret, check the bot, then save. Add allowed Feishu users in Settings → Evaluation. The local operator can submit requests from the main session page.

Optional `superagent.config.json`:

```json
{
  "stateDir": "/absolute/path/to/superagent-state",
  "port": 4317,
  "codexPath": "/absolute/path/to/codex"
}
```

Pass another configuration file with `npm start -- /absolute/path/config.json`. Missing configuration uses `~/.feishu-superagent`. Keep configuration and credentials outside the repository. Use a new state directory: old DSH databases and sessions are not imported.

`npm run dev` starts the TypeScript server and Vite hot-reloading panel on the same loopback address. `npm run check` runs type checking, tests, and production builds.

## Operation

By default each ticket has a private working directory and a persistent Codex thread. In Settings → Sources → Feishu → Chats, an optional project directory binds that chat to an existing project and a fixed Worker. Its tasks run serially and share the same Codex conversation; saving the binding grants workspace-write access to that directory. The domain Engine owns authorization and ticket lifecycle; ending a Codex turn does not imply a successful result. Codex permissions default to read-only for the router and workspace-write for workers. Extra permissions require an explicit local-panel approval. The panel is local-only and has no remote-user authentication.

Feishu uses the configured bot identity, including history recovery, original-message reads, images, member synchronization, and replies. Ordinary output goes through the durable Outbox. Local artifacts can be downloaded from the worker session page; local paths are not remote Feishu links.

Codex protocol tools are experimental and version-pinned. The service keeps uncertain deliveries for inspection instead of blindly repeating external work. A restart interrupts active work and expires outstanding approvals; inspect the session and retry the ticket from the panel.

Computer Use application approvals (`mcpServer/elicitation/request`) appear in the local panel. Confirmation-only forms can be approved or declined; Computer Use access is limited to the current Codex session, never persisted permanently by this panel. Forms requiring input, URL authentication and device verification are displayed but cannot be approved without a client that supports them. Expired or cancelled requests cannot be approved.

Standalone Workers do not create the desktop app's browser access host. Without that connection, Workers are instructed to use the installed Computer Use plugin's native Chrome application interface for navigation and screenshots, subject to application approval and macOS permissions. This provides window control, not DOM/tab automation. Refreshing a desktop chat does not connect an independently launched Worker to the desktop browser host.

For Feishu image results, Workers use `orchestrator_image_upload` with a workspace-relative PNG/JPEG/GIF/WebP (up to 10 MB), then include the returned `image_key` in `orchestrator_report.images`. The orchestrator passes those references in `orchestrator_reply.images`. The same configured bot uploads and sends; the Outbox persists the references and sends text plus images as one native post in the original thread, with a stable idempotency key. Uploading alone is not delivery. Local file paths and base64 are not valid outbound image references. A reply without a message target may address its explicit group `chatId` instead.

Dynamic tool definitions are fingerprinted. CLI 0.166 restores the original definitions when resuming a thread; it does not accept replacements through `thread/resume`. When definitions change (or a legacy session has no fingerprint), the adapter resumes to reconcile delivery history, then starts a provider thread with the current tools and a bounded historical handover. The application session, full local transcript, previous provider thread IDs, tickets and delivery ledger are retained. An active turn must finish before upgrading. Run `npx tsx scripts/smoke-tool-refresh.ts` to verify the transition against the real installed CLI without sending external messages.

See [SETUP.md](SETUP.md) and the numbered [design documents](docs/000-philosophy.md). The original architecture and licensing remain credited to the DeepSeek Harness Team; this application no longer depends on the DSH host.
