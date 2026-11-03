/** Independent deployment configuration; machine settings come from the startup config. */
import { localized } from './text.ts'
import { useSourceClients } from './source-plugins.tsx'
import type { SetupView } from './api.ts'
import { usePanel } from './provider.tsx'
import { CheckSetupButton, KeyValues, Section, SetupMessage } from './widgets.tsx'
export type DeploymentForm = undefined
export function DeploymentPage({ setup }: { setup: SetupView; form?: DeploymentForm; accounts?: boolean }) {
  const { t } = usePanel()
  const plugins = useSourceClients()
  return (
    <div className="dt-embedded">
      <Section title={t('deploymentMachine')}>
        <p>{t('app.startupConfig')}</p>
        <KeyValues rows={Object.entries(setup.machine).map(([k, v]) => [k, String(v)])} />
      </Section>
      {setup.problem && <SetupMessage problem={setup.problem} lead />}
      <CheckSetupButton />
      {(setup.connections ?? []).filter(connection => plugins.has(connection.kind)).map(connection =>
        <Section key={connection.id} title={localized(t, connection.title)}>
          {connection.account?.name ?? t('sourceAccountPending')}
          {connection.account && <KeyValues rows={connection.account.details.map(({ label, value }) => [label, value])} />}
        </Section>)}
    </div>
  )
}
