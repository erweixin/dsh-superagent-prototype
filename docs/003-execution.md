# 003 Execution

The Engine queues launches and deliveries through Effects. CodexExecutor prepares each ticket’s directory, reserves a worker slot, and creates or resumes its persistent Codex thread. Local directories are ordinary directories by default; an operator may supply a prepare command for project-specific setup.

Sessions composes role prompts and skills, records prompt revisions, and exposes the existing orchestrator tools through AgentRuntime. CodexRuntime is the only layer that understands app-server messages. It owns one child process per managed session and communicates over stdio. The router cannot modify files by default; workers use workspace-write permissions.

An assignment starts when delivery begins. Inputs retain their request IDs. A completed model turn updates activity, but only a structured report can declare the requested work ready. Reports, subscriptions, handbacks, human questions, retries and stop commands continue through Engine.

Delivery is recorded before sending. A confirmed delivery is not sent twice. A connection failure after sending may leave an uncertain record; restoration inspects persistent history for the delivery marker and otherwise refuses automatic replay. On service restart, running assignments wait for an operator to inspect and retry.

Extra permission requests remain pending until the local operator accepts or declines them. Each approval is tied to its session and turn. Shutdown invalidates pending requests; saved permissions are not silently replayed. Codex cancellation and process-group termination stop owned processes.

Local artifacts stay below the ticket directory. Downloads resolve real paths and reject symbolic links escaping that directory. Feishu responses describe local artifacts honestly and use the original conversation’s Outbox route.

Root turns, child-agent activity and unfinished command items all hold the Worker slot. Child agents cannot invoke the parent's business tools or complete its ticket; the root worker reports their combined outcome. Stopping a ticket cancels pending tool reads and interrupts its owned app-server before terminating its process group. Completed tool-call IDs and uncertain in-flight calls are persisted to prevent duplicate business effects. Unexpected provider failures are surfaced for inspection rather than retried as a new assignment.

Command and file-change approvals apply to the current request. The experimental additional-permissions endpoint only supports turn or session grants; this adapter always uses the narrower turn scope and never persists a session grant. Each new root turn explicitly resets the sandbox to the task directory, with inherited extra writable roots and temporary-directory write access disabled.

If Codex refuses `thread/resume` with an explicit missing-rollout error, the adapter may replace the provider thread only when the local session is idle and has no messages, input deliveries, consumed inputs, tool ledger entries or approval history. This handles unused threads that were never persisted by the provider. Any evidence of prior execution prevents replacement; ambiguous delivery and missing task history remain recovery failures.
