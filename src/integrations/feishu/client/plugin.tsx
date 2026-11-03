/** Feishu browser extension. Host services are injected; components do not read global panel state. */
import type { ConnectionPanelProps, SourceClientPlugin } from '../../../client/source-plugins.tsx'
import { FeishuConnectionForm } from './connection-form.tsx'
import { feishuSetupClient } from './api.ts'
import { FeishuAllowedPeople } from './people-picker.tsx'

function ConnectionPanel({ services, ...props }: ConnectionPanelProps) {
  return <FeishuConnectionForm {...props} t={services.t} configure={feishuSetupClient(services.call).configure} />
}
export const feishuClientPlugin: SourceClientPlugin = {
  kind: 'feishu',
  ConnectionPanel,
  policyFields: { allowed: FeishuAllowedPeople },
}
