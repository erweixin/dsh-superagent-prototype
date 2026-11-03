/** Serializable source settings contracts shared by server adapters and browser plugins. No runtime imports. */
export interface Localized { zh: string; en: string }
/** `advanced` folds a rarely changed field (such as a polling tunable) behind the card's Advanced section. */
interface FieldBase { key: string; label: Localized; hint?: Localized; advanced?: true }
/**
 * Configuration field specification; `rows` edits a list of records keyed by its first column, `choose` picks from
 * resolved source labels, and `fact` displays a read-only value from `facts`.
 */
export type FieldSpec =
  | FieldBase & { type: 'switch' }
  | FieldBase & { type: 'select'; options: { value: string; label: Localized }[] }
  | FieldBase & { type: 'number'; min: number; max: number }
  | FieldBase & { type: 'text'; pattern?: string; readonly?: boolean; choose?: Localized }
  | FieldBase & { type: 'fact'; settings?: 'deployment' }
  | FieldBase & { type: 'rows'; columns: ({ key: string; label: Localized; type: 'text'; pattern?: string; optional?: boolean; choose?: Localized; refresh?: Localized } | { key: string; label: Localized; type: 'select'; options: { value: string; label: Localized }[] })[] }

export interface AdmissionRowView { id: string; label: Localized | string; note: Localized; cells: { listedUnaddressed: boolean; unlistedAddressed: boolean; unlistedUnaddressed: boolean } }
export interface SourceProblem { place: string; code: string; values: Record<string, string>; detail: string }
export interface SourceHealth { state: 'starting' | 'ready' | 'paused' | 'error'; detail: string; at?: string; code?: string; values?: Record<string, string> }
export interface SourceConnection {
  configured: boolean
  account?: { id: string; name: string; details: { label: string; value: string }[] }
  problem?: SourceProblem
}
export interface SourceSettingsView {
  id: string
  kind: string
  title: Localized
  description: Localized
  installed: boolean
  value: { enabled: boolean; config: Record<string, unknown> }
  revision: number
  restarts: readonly string[]
  fields: FieldSpec[]
  facts: Record<string, Localized | string>
  labels: Record<string, string>
  problem?: SourceProblem
  connection?: SourceConnection
  policy?: {
    fields: FieldSpec[]
    explicit: Localized
    people?: boolean
    rows?: AdmissionRowView[]
    sync?: { label: Localized; ready: boolean; health?: SourceHealth }
  }
}
