import type { SourceSettingsView } from '../../src/contracts/source-settings.ts'
export const sourceView = (overrides: Partial<SourceSettingsView> = {}): SourceSettingsView => ({
  id: 'feishu', kind: 'feishu', title: { zh: '飞书', en: 'Feishu' }, description: { zh: '', en: '' },
  installed: true, value: { enabled: true, config: {} }, revision: 0, restarts: [], fields: [], facts: {}, labels: {},
  connection: { configured: false }, ...overrides,
})
