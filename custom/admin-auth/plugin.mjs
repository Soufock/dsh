/** Optional Cordis login plugin; the upstream Connection owns all session credentials. */
import { randomBytes } from 'node:crypto'
import { defaultCredentialFile, loadCredentials, verifyCredentials } from './credentials.mjs'
import { selectLocale } from './locales.mjs'
import { renderPage } from './page.mjs'

export const name = 'soufock-admin-auth'
export const inject = ['webServer', 'connection']

function positive(value, fallback, key, maximum) {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) throw new Error(`admin-auth: invalid ${key}`)
  return resolved
}

/**
 * Mount administrator login without replacing Connection, its token, or its cookies.
 * @param {object} ctx Cordis context with WebServer and Connection services.
 * @param {object} config Optional credentialFile, maxAttempts, windowSeconds, maxBodyBytes.
 * @returns {Promise<void>} Resolves after record validation and route registration.
 */
export async function apply(ctx, config = {}) {
  const credentialFile = config.credentialFile ?? defaultCredentialFile()
  if (typeof credentialFile !== 'string' || !credentialFile) throw new Error('admin-auth: credentialFile must be a path')
  await loadCredentials(credentialFile)
  const maxAttempts = positive(config.maxAttempts, 10, 'maxAttempts', 1000)
  const windowSeconds = positive(config.windowSeconds, 60, 'windowSeconds', 86400)
  const maxBodyBytes = positive(config.maxBodyBytes, 8192, 'maxBodyBytes', 65536)
  let windowStart = Date.now()
  let attempts = 0
  let checking = false

  const page = (req, res, status, error) => {
    const nonce = randomBytes(18).toString('base64')
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'referrer-policy': 'same-origin', 'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    })
    res.end(req.method === 'HEAD' ? undefined : renderPage(selectLocale(req.headers['accept-language']), nonce, error))
  }
  const reply = (res, status, text) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(text)
  }
  const trusted = (req, res) => {
    if (ctx.connection.requestRejection(req) !== 403) return true
    reply(res, 403, 'forbidden')
    return false
  }
  const current = req => ctx.connection.requestRejection(req) === undefined
  const secure = () => ctx.webServer.protocol === 'https:'

  const root = async (req, res) => {
    if (!trusted(req, res)) return
    if (req.method === 'POST') {
      // Browser form POSTs must name their origin; Connection validates that origin against Host.
      if (typeof req.headers.origin !== 'string'
        || req.headers['content-type']?.split(';', 1)[0].trim() !== 'application/x-www-form-urlencoded') {
        reply(res, 403, 'forbidden')
        return
      }
      const now = Date.now()
      if (now - windowStart >= windowSeconds * 1000) { windowStart = now; attempts = 0 }
      if (checking || attempts >= maxAttempts) {
        res.setHeader('retry-after', String(Math.max(1, Math.ceil((windowStart + windowSeconds * 1000 - now) / 1000))))
        page(req, res, 429, 'limited')
        return
      }
      attempts++
      checking = true
      try {
        const chunks = []
        let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > maxBodyBytes) { page(req, res, 413, 'malformed'); return }
          chunks.push(chunk)
        }
        const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
        const username = fields.get('username') ?? ''
        const password = fields.get('password') ?? ''
        if (fields.getAll('username').length !== 1 || fields.getAll('password').length !== 1
          || username.length > 64 || Buffer.byteLength(password) > 1024) {
          page(req, res, 400, 'malformed')
          return
        }
        const record = await loadCredentials(credentialFile)
        if (!await verifyCredentials(record, username, password)) { page(req, res, 401, 'invalid'); return }
        // Use the existing token exchange internally; the launch token never enters the document or redirect.
        ctx.connection.authorizeIndex({
          method: 'GET', headers: req.headers,
          url: ctx.connection.authenticatedUrl(ctx.webServer.getOrigin() + '/'),
        }, res)
      } catch (error) {
        ctx.emit('internal/error', new Error('admin-auth: password login failed; check the administrator record and server logs', { cause: error }))
        if (!res.headersSent) page(req, res, 503, 'unavailable')
      } finally {
        checking = false
      }
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { reply(res, 405, 'method not allowed'); return }
    // Capture the upstream index admission: token exchanges and invalid tokens keep their original response.
    let status = 401
    let headers = {}
    let body
    const admitted = ctx.connection.authorizeIndex(req, {
      writeHead(code, values) { status = code; headers = values ?? {} },
      end(value) { body = value },
    })
    if (!admitted) {
      if (status === 401 && !new URL(req.url, 'http://dsh.invalid').searchParams.has('token')) page(req, res, 200)
      else { res.writeHead(status, headers); res.end(body) }
      return
    }
    // The stock frontend fallback remains the owner of index rendering and boot injections.
    const request = new Request(ctx.webServer.getOrigin() + '/index.html', { method: req.method })
    const response = await ctx.webServer.readResource(request, ctx.connection.browserPeer)
    res.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
  }

  const me = async (req, res) => {
    if (!trusted(req, res)) return
    if (req.method !== 'GET') { reply(res, 405, 'method not allowed'); return }
    if (!current(req)) { reply(res, 401, 'unauthorized'); return }
    const record = await loadCredentials(credentialFile)
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ username: record.username, role: 'admin' }))
  }

  const logout = async (req, res) => {
    if (!trusted(req, res)) return
    if (req.method !== 'POST' || typeof req.headers.origin !== 'string') { reply(res, 403, 'forbidden'); return }
    if (!current(req)) { reply(res, 401, 'unauthorized'); return }
    const cookies = (req.headers.cookie ?? '').split(';').map(value => value.trim().split('=', 1)[0])
      .filter(value => /^dsh-auth-[A-Za-z0-9_-]+$/u.test(value))
    res.writeHead(303, {
      'location': '../', 'cache-control': 'no-store',
      'set-cookie': cookies.map(key => `${key}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure() ? '; Secure' : ''}`),
    })
    res.end()
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/', handler: root }), 'admin-auth: login and index')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/auth/me', handler: me }), 'admin-auth: administrator identity')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/auth/logout', handler: logout }), 'admin-auth: browser logout')
}
