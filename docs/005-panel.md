# 005 Panel

The independent React panel keeps the existing overview, receiving sources, evaluations, tickets, threads, settings and prompt editors. It prioritizes items requiring human action and preserves search, filters and detailed records.

The navigation opens a persistent main conversation or the worker conversation associated with a ticket. Session pages show stored messages, streamed output through short polling, current activity and errors. Main-conversation requests enter Engine through the panel source. Worker messages are recorded as ticket inputs.

Pending execution permissions appear separately with session, turn and operation details. Command/file approvals apply to the current request; additional-permissions requests expire at the end of the current turn. Expired requests cannot be reused after a restart.

Worker pages list local artifacts and download them through path-checked routes. Files outside the task directory and escaping symlinks are rejected. The panel does not publish local files to an externally reachable URL.

The service is loopback-only, with same-origin checks on management requests. It assumes a trusted local operator; multi-user login and remote administration are outside the first release.

Settings → Sources includes bot onboarding with CLI path, platform and application credentials. Connection checks read bot identity only; saving initializes an isolated CLI configuration, enables strict bot mode and reloads Runtime. Credentials are never read back or stored in browser drafts or business settings history. Application creation, permissions, event subscriptions and publication remain in the Feishu console.

Saved bot configuration is shown independently of the transient save notice. Reloading the panel restores the bot summary from server state and collapses credential entry. If startup fails, the saved source path still identifies the configuration as saved and the panel shows the startup problem; credentials never need to be re-entered merely because the panel was refreshed.
