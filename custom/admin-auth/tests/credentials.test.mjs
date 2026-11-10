/** Password-record validation, atomic updates, and page contracts. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadCredentials, saveCredentials, verifyCredentials } from '../credentials.mjs'
import { selectLocale } from '../locales.mjs'
import { renderPage } from '../page.mjs'

test('password records contain salted hashes, enforce permissions, and support rotation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-password-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'admin.json')
  await assert.rejects(loadCredentials(file), { code: 'ENOENT' })
  await assert.rejects(saveCredentials(file, 'admin', 'short'), /12–1024/u)
  await assert.rejects(saveCredentials(file, '<script>', 'long-enough-password'), /username/u)
  await saveCredentials(file, 'admin', 'long-enough-password')
  const first = await loadCredentials(file)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await readFile(file, 'utf8')).includes('long-enough-password'), false)
  assert.equal(await verifyCredentials(first, 'admin', 'long-enough-password'), true)
  assert.equal(await verifyCredentials(first, 'other', 'long-enough-password'), false)
  assert.equal(await verifyCredentials(first, 'admin', 'wrong'), false)
  await saveCredentials(file, 'admin', 'long-enough-password')
  assert.notEqual((await loadCredentials(file)).salt, first.salt)
  await saveCredentials(file, 'admin', 'replacement-password')
  assert.equal(await verifyCredentials(await loadCredentials(file), 'admin', 'long-enough-password'), false)
  await writeFile(file, JSON.stringify({ ...first, hash: 'invalid' }))
  await assert.rejects(loadCredentials(file), /Invalid administrator/u)
})

test('login copy respects supported language preference and password-manager semantics', () => {
  assert.equal(selectLocale('en-US,en;q=0.9,zh-CN;q=0.5'), 'en')
  assert.equal(selectLocale('zh-CN,zh;q=0.9'), 'zh-CN')
  assert.equal(selectLocale('zh;q=0,en;q=0.8'), 'en')
  assert.equal(selectLocale('de-DE'), 'en')
  for (const locale of ['en', 'zh-CN']) {
    const html = renderPage(locale, 'test-nonce', 'invalid')
    assert.match(html, /autocomplete="username"/u)
    assert.match(html, /autocomplete="current-password"/u)
    assert.match(html, /role="alert"/u)
    assert.match(html, /label for="password"/u)
    assert.match(html, /prefers-color-scheme:dark/u)
    assert.match(html, /prefers-reduced-motion/u)
    assert.doesNotMatch(html, /https?:\/\//u)
  }
})

test('password setup reads stdin without exposing the password in output or argv', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-password-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'admin.json')
  const cli = fileURLToPath(new URL('../password.mjs', import.meta.url))
  const args = [cli, '--file', file, '--username', 'admin', '--password-stdin']
  const password = 'cli-private-password!'
  const result = spawnSync(process.execPath, args, { input: password + '\n', encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal((result.stdout + result.stderr).includes(password), false)
  assert.equal(await verifyCredentials(await loadCredentials(file), 'admin', password), true)
  const short = spawnSync(process.execPath, args, { input: 'short\n', encoding: 'utf8' })
  assert.equal(short.status, 1)
  assert.equal(await verifyCredentials(await loadCredentials(file), 'admin', password), true)
})
