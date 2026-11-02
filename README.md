# Feishu Superagent

A standalone Node.js work assistant, with a React management panel, Feishu intake through `lark-cli`, and persistent Codex CLI worker sessions. Research prototype: review and adapt it before using it with your team.

The guiding principle remains: **take as little human attention as possible, and give as much value as possible**. Explicit requests and written rules authorize work. Routine progress stays internal; results and questions return to the original conversation.

## Start

Requirements: macOS or Linux, Node.js 22.19+, Codex CLI **0.153.4**, and a bot-only `lark-cli` configuration for Feishu. No DSH, GitHub CLI, or Git repository is required.

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

Each ticket has a private working directory and a persistent Codex thread. The domain Engine owns authorization and ticket lifecycle; ending a Codex turn does not imply a successful result. Codex permissions default to read-only for the router and workspace-write for workers. Extra permissions require an explicit local-panel approval. The panel is local-only and has no remote-user authentication.

Feishu uses the configured bot identity, including history recovery, original-message reads, images, member synchronization, and replies. Ordinary output goes through the durable Outbox. Local artifacts can be downloaded from the worker session page; local paths are not remote Feishu links.

Codex protocol tools are experimental and version-pinned. The service keeps uncertain deliveries for inspection instead of blindly repeating external work. A restart interrupts active work and expires outstanding approvals; inspect the session and retry the ticket from the panel.

See [SETUP.md](SETUP.md) and the numbered [design documents](docs/000-philosophy.md). The original architecture and licensing remain credited to the DeepSeek Harness Team; this application no longer depends on the DSH host.
