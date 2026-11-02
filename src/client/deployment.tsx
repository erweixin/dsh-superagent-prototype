/** Independent deployment configuration; machine settings come from the startup config. */
import type { SetupView } from './api.ts'
import { usePanel } from './provider.tsx'
import { CheckSetupButton, KeyValues, Section, SetupMessage } from './widgets.tsx'
export type DeploymentForm = undefined
export function DeploymentPage({ setup }: { setup: SetupView; form?: DeploymentForm; accounts?: boolean }) {
  const { t } = usePanel()
  return (
    <div className="dt-embedded">
      <Section title={t('deploymentMachine')}>
        <p>{t('app.startupConfig')}</p>
        <KeyValues rows={Object.entries(setup.machine).map(([k, v]) => [k, String(v)])} />
      </Section>
      {setup.problem && <SetupMessage problem={setup.problem} lead />}
      <CheckSetupButton />
      <Section title={t('deploymentFeishu')}>{setup.accounts?.feishu?.name ?? t('app.configureBot')}</Section>
    </div>
  )
}
