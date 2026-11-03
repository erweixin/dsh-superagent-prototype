/** Owns source consumers through registration, startup, cancellation and shutdown. */
import type { SourceHost } from './host.ts'
import type { SourceKind } from './kind.ts'
import type { SourceRegistry } from './registry.ts'

/** Runs every registered source with an independent lifetime and drains consumers before Store closes. */
export class SourceLoops {
  private started = false
  private closed = false
  private readonly active = new Map<string, { controller: AbortController; done: Promise<unknown> }>()
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly pending = new Set<Promise<unknown>>()
  constructor(private readonly host: SourceHost, private readonly registry: SourceRegistry,
    private readonly lifetime: AbortSignal, private readonly failed: (kind: string, error: unknown) => void) {}
  registered(kind: SourceKind): () => void {
    if (this.started) this.launch(kind)
    return () => {
      this.active.get(kind.kind)?.controller.abort()
      this.active.delete(kind.kind)
    }
  }
  start(): void {
    if (this.started || this.closed || this.lifetime.aborted) return
    this.started = true
    for (const kind of this.registry.installed()) this.launch(kind)
  }
  private launch(kind: SourceKind): void {
    if (!kind.run || this.closed || this.lifetime.aborted || this.active.has(kind.kind)) return
    const controller = new AbortController()
    const signal = AbortSignal.any([this.lifetime, controller.signal])
    const context = this.host.context(kind)
    const done = (this.tails.get(kind.kind) ?? Promise.resolve()).then(() => signal.aborted ? undefined : kind.run!(context, signal)).catch(error => {
      if (signal.aborted) return
      for (const name of kind.health) context.report(name, { state: 'error', detail: String(error) })
      this.failed(kind.kind, error)
    })
    this.active.set(kind.kind, { controller, done })
    this.tails.set(kind.kind, done)
    this.pending.add(done)
    void done.finally(() => { this.pending.delete(done) })
  }
  async stop(): Promise<void> {
    this.closed = true
    for (const { controller } of this.active.values()) controller.abort()
    await Promise.allSettled([...this.pending])
    this.active.clear()
    this.tails.clear()
  }
}
