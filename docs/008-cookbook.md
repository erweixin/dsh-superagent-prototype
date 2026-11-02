# 008 Cookbook: adding a Source

Implement a SourceKind with a configuration schema, receiving scope, optional policy roster and channel adapter. Register it in Runtime. Run event ingestion under the Runtime AbortSignal and submit normalized Triggers through SourceContext.receive.

Use stable event IDs and advance cursors only after intake commits. Never infer authorization from message text: actor identity and receiving scope come from the source adapter, and Policy controls which requests may create tickets.

Send replies through Outbox and SourceRegistry. The channel adapter must preserve its message ID across retries and distinguish permanent conversation loss from transient failures. Store source-specific cursors with typed KV keys. Add source tests without importing a provider runtime into core.
