/** Local credential entry: never read credentials back or persist them in browser storage. */
import { useRef, useState, type FormEvent } from 'react'
import { Button, Input } from '../../../client/controls.tsx'
import { Field, Fields } from '../../../client/settings-kit.tsx'
import type { ConnectionPanelProps } from '../../../client/source-plugins.tsx'
import type { FeishuBotSetupRequest, FeishuBotSetupResult } from '../shared/contracts.ts'
import { Hint, KeyValues } from '../../../client/widgets.tsx'

export interface FeishuConnectionProps extends Omit<ConnectionPanelProps, 'services'> {
  t: ConnectionPanelProps['services']['t']
  configure(request: FeishuBotSetupRequest): Promise<FeishuBotSetupResult>
}
export function FeishuConnectionForm({ source, t, configure, runningCount, problem, onChanged, onRestartRequired, onOpenPolicy }: FeishuConnectionProps) {
  const bot = source.connection?.account
  const configured = source.connection?.configured || !!bot
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    const action =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'save' ? 'save' : 'check'
    pending.current = true
    setBusy(true)
    setResult('')
    setError('')
    try {
      const response = await configure({
        action,
        cli: String(data.get('cli') ?? ''),
        appId: String(data.get('appId') ?? '').trim(),
        appSecret: String(data.get('appSecret') ?? ''),
        brand: data.get('brand') === 'lark' ? 'lark' : 'feishu'
      })
      setResult(
        t(response.saved ? 'botSetupSaved' : 'botSetupChecked', {
          name: response.bot.name || response.bot.botId
        })
      )
      if (response.saved) {
        const secret = form.elements.namedItem('appSecret') as HTMLInputElement
        secret.value = ''
        setEditing(false)
        if (response.restarting) onRestartRequired()
        else await onChanged()
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('botSetupFailed'))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      {configured && (
        <section className="dt-card" aria-label={t('botSetupConfigured')}>
          <div className="dt-card-head">
            <span className="dt-card-title">{t('botSetupConfigured')}</span>
          </div>
          {bot ? (
            <KeyValues
              rows={[
                [t('feishuBot'), bot.name || bot.id],
                ...bot.details.map(({ label, value }): [string, string] => [label === 'Platform' ? t('botSetupBrand') : label, value])
              ]}
            />
          ) : (
            <Hint>{t('botSetupStored')}</Hint>
          )}
          <Hint>{t(source.value.enabled === false ? 'botSetupDisabled' : 'botSetupNext')}</Hint>
          {problem}
          <div className="dt-row-buttons">
            <Button onClick={() => setEditing(!editing)}>{t(editing ? 'cancel' : 'botSetupEdit')}</Button>
            <Button onClick={onOpenPolicy}>{t('botSetupAllowed')}</Button>
          </div>
        </section>
      )}
      {(!configured || editing) && (
        <form
          className="dt-card"
          autoComplete="off"
          onSubmit={(event) => {
            void submit(event)
          }}
          onChange={() => {
            setResult('')
            setError('')
          }}
        >
          <Fields disabled={busy}>
            <div className="dt-card-head">
              <span className="dt-card-title">{t('botSetupTitle')}</span>
            </div>
            <Hint>
              {t('botSetupIntro')}{' '}
              <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
                {t('botSetupConsole')}
              </a>
            </Hint>
            <Hint>
              {t('botSetupInstall')} <code>npx @larksuite/cli@latest install</code>
            </Hint>
            <Field label={t('botSetupCLI')} note={t('botSetupCLIHint')}>
              <Input name="cli" defaultValue="lark-cli" required autoComplete="off" />
            </Field>
            <Field label={t('botSetupBrand')}>
              <select name="brand" className="dt-input" defaultValue="feishu">
                <option value="feishu">飞书</option>
                <option value="lark">Lark</option>
              </select>
            </Field>
            <Field label="App ID">
              <Input
                name="appId"
                placeholder="cli_…"
                required
                pattern="cli_[a-zA-Z0-9]+"
                autoComplete="off"
              />
            </Field>
            <Field label="App Secret" note={t('botSetupSecretHint')}>
              <Input name="appSecret" type="password" required maxLength={2048} autoComplete="new-password" />
            </Field>
            <Hint>{t('botSetupPermissions')}</Hint>
            {runningCount > 0 && <Hint>{t('restartInterrupts', { count: runningCount })}</Hint>}
            <div className="dt-row-buttons">
              <Button type="submit" value="check" variant="outline">
                {t('botSetupCheck')}
              </Button>
              <Button type="submit" value="save" variant="primary">
                {t('botSetupSave')}
              </Button>
              {busy && <span role="status">{t('botSetupWorking')}</span>}
            </div>
          </Fields>
          {result && (
            <p className="dt-hint" role="status">
              {result}
            </p>
          )}
          {error && (
            <p className="dt-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </>
  )
}
