/** Real-profile test fixture with isolated credentials, ports, and process teardown. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveCredentials } from '../credentials.mjs'

/**
 * Start the installed (or DSH_BIN-selected) dsh profile with the real plugin overlay.
 * @param {{maxAttempts?: number, maxBodyBytes?: number}} options Test configuration.
 * @returns {Promise<object>} URLs, password, cookie helpers and asynchronous cleanup.
 */
export async function startHarness(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-admin-auth-'))
  const password = 'test-password-7f5c932!'
  const credentialFile = join(root, 'admin-auth.json')
  await saveCredentials(credentialFile, 'admin', password)
  const plugin = fileURLToPath(new URL('../plugin.mjs', import.meta.url))
  const overlay = join(root, 'auth.patch.yml')
  await writeFile(overlay, `- insert:\n    - id: soufock-admin-auth\n      name: ${JSON.stringify(plugin)}\n      config:\n        credentialFile: ${JSON.stringify(credentialFile)}\n        maxAttempts: ${options.maxAttempts ?? 30}\n        maxBodyBytes: ${options.maxBodyBytes ?? 8192}\n`)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(key)))
  const child = spawn(process.env.DSH_BIN || 'dsh', ['web', '--patch', overlay, '--no-open', '--port', '0'], {
    cwd: root,
    env: { ...env, DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', SSH_CONNECTION: '', SSH_TTY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const redact = value => value.replace(/([?&]token=)[^\s]+/gu, '$1<redacted>')
  const append = chunk => { output = (output + String(chunk)).slice(-100_000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      timer.unref()
      try { await exit } finally { clearTimeout(timer) }
    }
    await rm(root, { recursive: true, force: true })
  }
  let launchUrl
  try {
    launchUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Profile startup timed out: ${redact(output)}`)), 90_000)
      const inspect = () => {
        const found = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
        if (found) finish(undefined, found[1])
      }
      const exited = () => finish(new Error(`Profile exited before readiness: ${redact(output)}`))
      const failed = error => finish(error)
      function finish(error, value) {
        clearTimeout(timer)
        child.stdout.off('data', inspect)
        child.stderr.off('data', inspect)
        child.off('exit', exited)
        child.off('error', failed)
        if (error) reject(error)
        else resolve(value)
      }
      child.stdout.on('data', inspect)
      child.stderr.on('data', inspect)
      child.once('exit', exited)
      child.once('error', failed)
      inspect()
    })
  } catch (error) { await close(); throw error }
  const origin = new URL(launchUrl).origin
  const request = (path = '/', init = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...init })
  const login = (username = 'admin', value = password, extra = {}) => request('/', {
    method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded', ...extra },
    body: new URLSearchParams({ username, password: value }),
  })
  return { root, credentialFile, password, child, launchUrl, origin, request, login, close, output: () => redact(output) }
}
