import { expect, it } from 'vitest'
import { browserContext } from '../src/executor/browser-context.ts'

it('routes standalone workers to native application access without claiming a desktop browser connection', () => {
  expect(browserContext({})).toContain('cua.getApp("com.google.Chrome")')
  expect(browserContext({ BROWSER_USE_ACCESS_PIPE_PATH: '/partial' })).toContain('not connected')
  expect(browserContext({ BROWSER_USE_ACCESS_PIPE_PATH: '/pipe', BROWSER_USE_ACCESS_VERIFYING_IDENTITY: 'identity' })).toBe('')
})
