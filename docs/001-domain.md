# 001 Domain model

The project is a proactive work assistant. Its domain remains independent of its application shell, agent provider and communication source.

| Concept | Responsibility |
| --- | --- |
| Source | Receives external events and identifies actors, conversations and receiving scope. The built-in sources are Feishu and the local operator panel. |
| Trigger | One immutable normalized event, deduplicated by its source ID. Message text is untrusted context. |
| Thread | A conversation with subscriptions, pending triggers and evaluation state. |
| Eval | Batches related triggers for bounded assessment under a particular policy version. |
| Decision | Records accept, ignore, stop or unavailable, with its evidence and reasoning. |
| Ticket | Authorized work, its origin, mandate, inputs, subscriptions, execution and completion state. |
| Mandate | Who authorized the work, with what strength and under which rules. Context does not expand it. |
| Assignment | One execution attempt belonging to a ticket; retries create later assignments. |
| Input | A message, contextual note or policy change delivered to a worker. Delivery and consumption are distinct. |
| Channel | The original reply destination; Outbox delivers authorized replies with stable IDs. |
| Report | Structured worker progress, result or question. A model turn ending is not a ready report. |

Engine is the sole aggregate writer. Each command changes state in a synchronous transaction and queues external work for after commit. Source adapters, UI routes and model tools cannot silently bypass that boundary.

A message on a subscribed thread can reach its ticket as a follow-up. Context-only subscriptions provide context without authority. Ended tickets may resume under a valid mandate; a ticket explicitly stopped by a person does not silently resume. The worker decides its owned follow-ups and hands unrelated requests back to assessment.

Tickets without outstanding bound-thread completion conditions finish on a ready report. The generic followed-thread completion model remains available to future sources, although this release does not monitor remote code review or merge events.
