/** The desktop browser host is not supplied to standalone app-server workers.
 * Native Computer Use is a separate supported connection and still requires app approval. */
export function browserContext(environment: NodeJS.ProcessEnv): string {
  if (environment.BROWSER_USE_ACCESS_PIPE_PATH && environment.BROWSER_USE_ACCESS_VERIFYING_IDENTITY) return ''
  return `\n\nBrowser connection for this standalone Superagent session:
- The app-managed browser access host is not connected. Do not repeatedly call createBrowserTab/getBrowser or ask the user to refresh the desktop session to fix it.
- When Computer Use is available, use its documented native application API (cua.getApp("com.google.Chrome")) to navigate and capture the browser window. Read the tool documentation before interacting. This does not provide DOM/browser-tab APIs.
- Application access requests are forwarded to the local Superagent management panel. Wait for the operator's decision; a chat reply is not an application permission grant. Never bypass a denied app permission or a system restriction.
- If native Computer Use is unavailable or denied, report that specific limitation. Do not invent a browser host, reuse another session's identity, or silently switch to shell/browser automation.`
}
