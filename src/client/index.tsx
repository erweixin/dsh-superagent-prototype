import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { Button } from './controls.tsx'
import { zh, en } from './locales.ts'
import type { T } from './text.ts'
import type { AgentSession, Approval } from '../app/agent-runtime.ts'
import './client.css'
import './standalone.css'
async function request(path: string, value?: unknown) {
  const r = await fetch(`/orchestrator/api/${path}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { 'x-orchestrator-request': '1', 'content-type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) })
  })
  const body = await r.json()
  if (!r.ok) throw new Error(body.error ?? r.statusText)
  return body
}
function Root() {
  const [session, setSession] = useState<string>(),
    [data, setData] = useState<{
      masterId?: string
      sessions: (AgentSession & { ticketId?: string })[]
      approvals: Approval[]
      replies: { id: string; text: string }[]
    }>({ sessions: [], approvals: [], replies: [] }),
    [text, setText] = useState(''),
    [draftTicket, setDraftTicket] = useState<string>(),
    [error, setError] = useState(''),
    [connectionError, setConnectionError] = useState(''),
    [busy, setBusy] = useState(false),
    [files, setFiles] = useState<string[]>(),
    [language, setLanguage] = useState<'zh' | 'en'>(() =>
      localStorage.getItem('superagent-language') === 'en' ? 'en' : 'zh'
    )
  const t: T = (key, values) => {
    let value = (language === 'zh' ? zh : en)[key] ?? key
    for (const [k, v] of Object.entries(values ?? {})) value = value.replaceAll(`{${k}}`, String(v))
    return value
  }
  useEffect(() => {
    let disposed = false
    const load = async () => {
      try {
        const next = await request('sessions')
        if (!disposed) {
          setData(next)
          setConnectionError('')
        }
      } catch (e) {
        if (!disposed) setConnectionError(String(e))
      }
    }
    void load()
    const timer = setInterval(() => void load(), 1000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])
  const current = data.sessions.find((s) => s.id === session),
    ticket = current?.ticketId
  useEffect(() => { setFiles(undefined) }, [session, ticket])
  useEffect(() => { setText(''); setDraftTicket(undefined) }, [session])
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <header className="sa-header">
        <strong>Feishu Superagent</strong>
        <nav aria-label={t('app.sessions')}>
          <Button onClick={() => setSession(undefined)}>{t('app.panel')}</Button>
          <Button onClick={() => setSession(data.masterId ?? 'main')}>{t('app.main')}</Button>
        </nav>
        <select
          className="dt-select sa-language"
          aria-label={t('app.language')}
          value={language}
          onChange={(e) => {
            const next = e.target.value as 'zh' | 'en'
            setLanguage(next)
            localStorage.setItem('superagent-language', next)
          }}
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </header>
      {(error || connectionError) && (
        <p className="dt-banner dt-danger sa-notice" role="alert">
          {error || connectionError}
        </p>
      )}
      {data.approvals
        .filter((a) => a.state === 'pending')
        .map((a) => (
          <section key={a.id} className="dt-banner sa-notice">
            <strong>
              {t(a.elicitation ? 'app.applicationApproval' : 'app.approval')} · {a.sessionId}
            </strong>
            {a.method === 'item/permissions/requestApproval' && <p>{t('app.permissionScope')}</p>}
            {a.elicitation && <>
              <p>{a.elicitation.serverName} · {a.elicitation.message}</p>
              <p>{t(!a.elicitation.canAccept ? 'app.unsupportedElicitation' : a.elicitation.session ? 'app.applicationSessionScope' : 'app.applicationRequestScope')}</p>
              {a.elicitation.session && <p>{t('app.applicationAccessWarning')}</p>}
            </>}
            {a.elicitation ? <details><summary>{t('app.approvalDetails')}</summary><pre className="sa-text">{JSON.stringify(a.detail, null, 2)}</pre></details>
              : <pre className="sa-text">{JSON.stringify(a.detail, null, 2)}</pre>}
            <div className="dt-actions">
              <Button disabled={busy || a.elicitation?.canAccept === false} onClick={() => void act(() => request('approval', { id: a.id, accept: true }))}>
                {t(a.elicitation?.session ? 'app.approveSession' : 'app.approve')}
              </Button>
              <Button disabled={busy} onClick={() => void act(() => request('approval', { id: a.id, accept: false }))}>
                {t('app.reject')}
              </Button>
            </div>
          </section>
        ))}
      {session ? (
        <main className="sa-chat">
          <div className="dt-head">
            <h1>{current?.title ?? t('app.main')}</h1>
            {current && <span className="dt-hint">{t(`app.status.${current.status}`)}</span>}
          </div>
          <select
            className="dt-select"
            aria-label={t('app.sessions')}
            value={session}
            onChange={(e) => setSession(e.target.value)}
          >
            {data.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {ticket && <p className="dt-hint">{t('app.currentTicket', { ticket })}<br />{current?.cwd}</p>}
          {current?.error && <p className="dt-banner dt-danger">{current.error}</p>}
          {!current && <p className="dt-hint">{t('app.noSession')}</p>}
          {current?.messages.length === 0 && <p className="sa-empty">{t('app.empty')}</p>}
          <div className="sa-transcript" aria-live="polite">
            {current?.messages.map((m) =>
              m.role === 'tool' || m.role === 'system' ? (
                <details key={m.id} className="sa-message">
                  <summary>
                    {t(`app.role.${m.role}`)} · {m.at}
                  </summary>
                  <pre className="sa-text">{m.text}</pre>
                </details>
              ) : (
                <article className={`sa-message sa-message-${m.role}`} key={m.id}>
                  <small className="dt-hint">
                    {t(`app.role.${m.role}`)} · {m.at}
                  </small>
                  <pre className="sa-text">{m.text}</pre>
                </article>
              )
            )}
            {current?.role === 'orchestrator' &&
              data.replies.map((r) => (
                <article className="sa-message" key={r.id}>
                  <strong>{t('app.reply')}</strong>
                  <p className="sa-text">{r.text}</p>
                </article>
              ))}
          </div>
          <form
            className="sa-composer"
            onSubmit={(e) => {
              e.preventDefault()
              void act(async () => {
                await request('session/message', { sessionId: session, ticketId: draftTicket, text })
                setText('')
              })
            }}
          >
            <textarea
              className="dt-textarea"
              aria-label={t('app.message')}
              value={text}
              onChange={(e) => { if (!text) setDraftTicket(ticket); setText(e.target.value) }}
              rows={4}
            />
            {text && draftTicket !== ticket && <p role="alert">{t('app.draftTicketChanged')}</p>}
            <Button type="submit" variant="primary" disabled={busy || !text.trim() || !current}>
              {t('app.send')}
            </Button>
          </form>
          {ticket && (
            <section className="dt-section">
              <Button
                onClick={() =>
                  void act(async () =>
                    setFiles((await request(`artifacts?ticket=${encodeURIComponent(ticket)}`)).files)
                  )
                }
              >
                {t('app.artifacts')}
              </Button>
              <p className="dt-hint">{t('app.fileAccess')}</p>
              {files?.length === 0 && <p className="dt-hint">{t('app.noArtifacts')}</p>}
              {files?.map((file) => (
                <Button
                  key={file}
                  onClick={() =>
                    void act(async () => {
                      const r = await fetch(
                        `/orchestrator/api/artifact?ticket=${encodeURIComponent(ticket)}&path=${encodeURIComponent(file)}`,
                        { headers: { 'x-orchestrator-request': '1' } }
                      )
                      if (!r.ok) throw new Error(t('app.downloadFailed'))
                      const url = URL.createObjectURL(await r.blob()),
                        a = document.createElement('a')
                      a.href = url
                      a.download = file.split('/').at(-1)!
                      a.click()
                      setTimeout(() => URL.revokeObjectURL(url), 1000)
                    })
                  }
                >
                  {file}
                </Button>
              ))}
            </section>
          )}
          {data.approvals.some((a) => a.sessionId === session) && (
            <details>
              <summary>{t('app.approvalHistory')}</summary>
              {data.approvals
                .filter((a) => a.sessionId === session)
                .map((a) => (
                  <p key={a.id}>
                    {a.at} · {t(`app.approval.${a.state}`)}
                  </p>
                ))}
            </details>
          )}
        </main>
      ) : (
        <App t={t} deploymentForm={undefined} openSession={async (id) => setSession(id)} />
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Root />)
