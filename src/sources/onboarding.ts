/** Dispatches local-operator onboarding to registered source handlers without knowing their payloads. */
import type { SourceKind } from './kind.ts'
import type { SourceSetupHost } from './server.ts'
import type { SourceRegistry } from './registry.ts'

/** HTTP-server lifetime dispatcher; per-plugin handlers survive in-process Runtime restarts. */
export class SourceOnboarding {
  private readonly routes = new Map<string, { kind: string; run: (host: SourceSetupHost, value: unknown) => Promise<unknown> }>()
  constructor(kinds: readonly SourceKind[]) {
    for (const kind of kinds) {
      const onboarding = kind.setup?.onboarding
      if (!onboarding) continue
      if (this.routes.has(onboarding.path)) throw new Error(`Duplicate source onboarding route: ${onboarding.path}`)
      this.routes.set(onboarding.path, { kind: kind.kind, run: onboarding.create() })
    }
  }
  handler(path: string, sources: SourceRegistry) {
    const route = this.routes.get(path)
    return route && sources.kind(route.kind) ? route.run : undefined
  }
}
