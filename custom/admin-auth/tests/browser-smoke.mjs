/** Real-browser regression for native form Origin, cookies, themes, and mobile layout. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHarness } from './helpers.mjs'

const { chromium } = await import(process.env.DSH_PLAYWRIGHT_MODULE || 'playwright')
const artifacts = process.env.DSH_BROWSER_ARTIFACTS || await mkdtemp(join(tmpdir(), 'dsh-login-browser-'))
await mkdir(artifacts, { recursive: true })
const browser = await chromium.launch({
  ...(process.env.DSH_CHROMIUM ? { executablePath: process.env.DSH_CHROMIUM } : {}),
  headless: true,
  args: process.getuid?.() === 0 ? ['--no-sandbox'] : [],
})
let app
try {
  app = await startHarness()
  const variants = [
    { name: 'desktop-light', width: 1100, height: 800, colorScheme: 'light', locale: 'en-US' },
    { name: 'mobile-dark', width: 375, height: 800, colorScheme: 'dark', locale: 'zh-CN' },
    { name: 'narrow-light', width: 320, height: 800, colorScheme: 'light', locale: 'zh-CN' },
    { name: 'desktop-dark', width: 1100, height: 800, colorScheme: 'dark', locale: 'en-US' },
    { name: 'landscape', width: 667, height: 375, colorScheme: 'light', locale: 'en-US' },
  ]
  for (const variant of variants) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height },
      colorScheme: variant.colorScheme, locale: variant.locale, reducedMotion: 'reduce' })
    try {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(app.origin)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.keyboard.press('Tab')
      assert.equal(await page.locator('#username').evaluate(input => input === document.activeElement), true)
      await page.screenshot({ path: join(artifacts, `${variant.name}.png`), fullPage: true })
      await page.locator('#username').fill('admin')
      await page.locator('#password').fill('wrong')
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.locator('button').click()])
      assert.match(await page.locator('#error').innerText(), variant.locale === 'zh-CN' ? /账号或密码错误/u : /Incorrect username or password/u)
      await page.screenshot({ path: join(artifacts, `${variant.name}-error.png`), fullPage: true })
      await page.locator('#username').fill('admin')
      await page.locator('#password').fill(app.password)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.locator('button').click()])
      assert.equal(await page.locator('input[autocomplete="current-password"]').count(), 0)
      assert.deepEqual(await page.evaluate(async () => (await fetch('./auth/me')).json()), { username: 'admin', role: 'admin' })
      assert.equal(await page.evaluate(async () => (await fetch('./auth/logout', { method: 'POST' })).status), 200)
      await page.goto(app.origin)
      assert.equal(await page.locator('input[autocomplete="current-password"]').count(), 1)
      assert.deepEqual(errors, [])
      process.stdout.write(`${variant.name}: layout, keyboard, error, password login, identity, logout passed\n`)
    } finally { await context.close() }
  }
  const tokenContext = await browser.newContext()
  try {
    const page = await tokenContext.newPage()
    await page.goto(app.launchUrl)
    await page.waitForLoadState('networkidle')
    assert.equal(new URL(page.url()).searchParams.has('token'), false)
    assert.deepEqual(await page.evaluate(async () => (await fetch('./auth/me')).json()), { username: 'admin', role: 'admin' })
    process.stdout.write('Original token: clean redirect and administrator identity passed\n')
  } finally { await tokenContext.close() }
  process.stdout.write(`Browser artifacts: ${artifacts}\n`)
} finally {
  await app?.close()
  await browser.close()
}
