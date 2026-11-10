/** Self-contained, password-manager-compatible login document. */
import { dictionaries } from './locales.mjs'

const escape = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

/**
 * Render the login page with locale-owned error copy and no external assets.
 * @param {'en' | 'zh-CN'} locale Page language.
 * @param {string} nonce CSP nonce.
 * @param {'invalid' | 'limited' | 'unavailable' | 'malformed' | undefined} error Error code.
 * @returns {string} Complete HTML.
 */
export function renderPage(locale, nonce, error) {
  const t = dictionaries[locale]
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title} · DeepSeek Harness</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;--bg:#f7f8fa;--card:#fff;--ink:#18212f;--muted:#596579;--line:#ccd2dc;--brand:#315ae8;--on-brand:#fff;--error:#b42318;--focus:#315ae8;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font-size:16px;line-height:1.5}
main{width:100%;max-width:400px;padding:32px;background:var(--card);border:1px solid var(--line);border-radius:16px}header{margin-bottom:24px}.brand{font-size:13px;color:var(--muted);margin:0 0 16px}h1{font-size:24px;font-weight:500;line-height:1.3;margin:0 0 8px}.subtitle{margin:0;color:var(--muted);font-size:14px}
label{display:block;font-size:14px;margin-bottom:8px}input{display:block;width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font:inherit}.field+.field{margin-top:16px}button{width:100%;min-height:44px;margin-top:8px;border:0;border-radius:8px;background:var(--brand);color:var(--on-brand);font:inherit;font-weight:500;cursor:pointer;transition:filter .15s}button:hover{filter:brightness(.9)}button:disabled{opacity:.65;cursor:wait}input:focus-visible,button:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.error{min-height:48px;margin:8px 0;color:var(--error);font-size:14px;overflow-wrap:anywhere}.hint{font-size:13px;color:var(--muted);margin:24px 0 0}
@media(prefers-color-scheme:dark){:root{--bg:#15171b;--card:#202328;--ink:#f1f3f8;--muted:#b2bdce;--line:#596579;--brand:#a8bbff;--on-brand:#182347;--error:#ffb4aa;--focus:#a8bbff}}
@media(max-width:420px){body{padding:16px}main{padding:24px}h1{font-size:22px}}
@media(prefers-reduced-motion:reduce){button{transition:none}}
</style></head><body><main aria-labelledby="title"><header><p class="brand">DeepSeek Harness</p><h1 id="title">${t.title}</h1><p class="subtitle">${t.subtitle}</p></header>
<form method="post" action="./" aria-describedby="error">
<div class="field"><label for="username">${t.username}</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="64"></div>
<div class="field"><label for="password">${t.password}</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"></div>
<p class="error" id="error" role="alert">${error ? escape(t[error]) : ''}</p>
<button type="submit">${t.submit}</button></form><p class="hint">${t.token}</p></main>
<script nonce="${nonce}">document.querySelector('form').addEventListener('submit',function(){const b=this.querySelector('button');b.disabled=true;b.textContent=${JSON.stringify(t.pending)}});window.addEventListener('pageshow',function(){const b=document.querySelector('button');b.disabled=false;b.textContent=${JSON.stringify(t.submit)}});</script>
</body></html>`
}
