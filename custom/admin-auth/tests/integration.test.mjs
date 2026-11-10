/** Password and token login through the real installed dsh Web profile. */
import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { test } from 'node:test'
import { saveCredentials } from '../credentials.mjs'
import { startHarness } from './helpers.mjs'

const cookieFrom = response => response.headers.get('set-cookie')?.split(';', 1)[0]

test('password and upstream token authenticate the same administrator', { timeout: 120_000 }, async t => {
  const app = await startHarness()
  t.after(app.close)
  await t.test('unauthenticated root serves localized login while APIs remain protected', async () => {
    const response = await app.request('/', { headers: { 'accept-language': 'zh-CN' } })
    assert.equal(response.status, 200, app.output())
    const html = await response.text()
    assert.match(html, /管理员登录/u)
    assert.equal(html.includes(new URL(app.launchUrl).searchParams.get('token')), false)
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/u)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('referrer-policy'), 'same-origin')
    assert.equal((await app.request('/auth/me')).status, 401)
    assert.equal((await app.request('/api/settings/describe', { method: 'POST' })).status, 401)
    const head = await app.request('/', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(await head.text(), '')
  })
  await t.test('invalid credentials, duplicate fields, missing origin, and cross-site posts are rejected', async () => {
    assert.equal((await app.login('admin', 'wrong')).status, 401)
    assert.equal((await app.login('unknown', app.password)).status, 401)
    assert.equal((await app.login('admin', app.password, { origin: 'https://attacker.invalid' })).status, 403)
    assert.equal((await app.login('admin', app.password, { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await app.request('/', { method: 'POST', body: new URLSearchParams({ username: 'admin', password: app.password }) })).status, 403)
    assert.equal((await app.request('/', {
      method: 'POST', headers: { origin: app.origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: `username=admin&username=other&password=${app.password}`,
    })).status, 400)
    assert.equal((await app.request('/?token=invalid')).status, 401)
  })
  let passwordCookie
  await t.test('password success uses the original HttpOnly session cookie without disclosing the token', async () => {
    const response = await app.login()
    assert.equal(response.status, 303, app.output())
    assert.equal(response.headers.get('location'), './')
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/u)
    passwordCookie = cookieFrom(response)
    assert.ok(passwordCookie?.startsWith('dsh-auth-'))
    const identity = await app.request('/auth/me', { headers: { cookie: passwordCookie } })
    assert.deepEqual(await identity.json(), { username: 'admin', role: 'admin' })
    const index = await app.request('/', { headers: { cookie: passwordCookie } })
    assert.equal(index.status, 200)
    const html = await index.text()
    assert.match(html, /__DSH_BOOT__/u)
    assert.doesNotMatch(html, /autocomplete="current-password"/u)
    const api = await app.request('/api/settings/describe', {
      method: 'POST', headers: { cookie: passwordCookie, 'content-type': 'application/json', origin: app.origin },
      body: JSON.stringify({ type: 'client-request', rpcId: 'admin-login-test', method: 'settings/describe', payload: { args: {} } }),
    })
    assert.equal(api.status, 200)
    assert.equal((await api.json()).result.ok, true)
  })
  await t.test('original launch token also maps to the configured administrator', async () => {
    const exchange = await app.request(app.launchUrl)
    assert.equal(exchange.status, 303)
    const cookie = cookieFrom(exchange)
    assert.ok(cookie)
    const identity = await app.request('/auth/me', { headers: { cookie } })
    assert.deepEqual(await identity.json(), { username: 'admin', role: 'admin' })
  })
  await t.test('logout requires a same-origin POST and expires the upstream cookie', async () => {
    assert.equal((await app.request('/auth/logout', { headers: { cookie: passwordCookie } })).status, 403)
    assert.equal((await app.request('/auth/logout', { method: 'POST', headers: { cookie: passwordCookie } })).status, 403)
    const response = await app.request('/auth/logout', { method: 'POST', headers: { cookie: passwordCookie, origin: app.origin } })
    assert.equal(response.status, 303)
    assert.match(response.headers.get('set-cookie'), /Max-Age=0; HttpOnly; SameSite=Strict/u)
    assert.equal((await app.request('/auth/me', { headers: { cookie: cookieFrom(response) } })).status, 401)
  })
  await t.test('password rotation takes effect without restarting and missing records fail closed', async () => {
    await saveCredentials(app.credentialFile, 'administrator', 'rotated-password-2026!')
    assert.equal((await app.login()).status, 401)
    const response = await app.login('administrator', 'rotated-password-2026!')
    assert.equal(response.status, 303)
    const token = await app.request(app.launchUrl)
    assert.deepEqual(await (await app.request('/auth/me', { headers: { cookie: cookieFrom(token) } })).json(), { username: 'administrator', role: 'admin' })
    await rm(app.credentialFile)
    assert.equal((await app.login()).status, 503)
    assert.equal((await app.request(app.launchUrl)).status, 303)
  })
})

test('bounded global login attempts reject guessing and oversized bodies', { timeout: 120_000 }, async t => {
  const app = await startHarness({ maxAttempts: 2, maxBodyBytes: 128 })
  t.after(app.close)
  const oversized = await app.login('admin', 'x'.repeat(512))
  assert.equal(oversized.status, 413)
  assert.equal((await app.login('admin', 'wrong')).status, 401)
  const limited = await app.login()
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  // Password throttling cannot disable the original recovery token.
  assert.equal((await app.request(app.launchUrl)).status, 303)
})
