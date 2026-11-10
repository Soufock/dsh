# Administrator login

English | [中文](README.zh.md)

This optional Cordis plugin adds one administrator account to the standard `dsh web` profile. Password and original launch-token login both use Connection's existing owner Peer and signed HttpOnly cookie. No upstream implementation, authentication format, Agent code, workspace, or session store is changed.

## Setup

Install the official `@deepseek-ai/dsh` release matching the version in the repository's root `package.json` (currently `0.2.2-rc.1`), using Node.js 24.9 or newer. From this checkout, create the administrator password and launch with the overlay before application flags:

```sh
node custom/admin-auth/password.mjs --username admin
dsh web --patch "$PWD/custom/admin-auth/cordis.patch.yml" --no-open
```

The command asks for the password twice without echoing it. Passwords must contain 12–1024 UTF-8 bytes. The record lives at `$DSH_HOME/admin-auth.json`, or `~/.dsh/admin-auth.json` when `DSH_HOME` is unset; it contains a random salt and scrypt hash, has owner-only permissions, and must stay outside the repository. Use the same `DSH_HOME` when setting the password and running dsh. Automation can pipe a secret through `--password-stdin`; never pass a password in command arguments.

Opening the clean server address shows a login form. The full `?token=...` URL printed by dsh retains its original behavior and logs in as this administrator. Treat that link as an administrator credential. Both methods return to the standard Web UI; choose a workspace and configure a model there as usual.

To enable the plugin for every `dsh web` launch, append an `insert` entry to `$DSH_HOME/profiles/web/cordis.patch.yml` with id `soufock-admin-auth` and the **absolute** `name` path to this directory's `plugin.mjs`. Keep any existing profile entries. Do not also pass the command-line overlay, which would insert the same id twice. Removing the inserted row restores the upstream token-only entry.

## Settings and operations

The overlay exposes `credentialFile` (optional absolute password-record path), `maxAttempts` (default 10), `windowSeconds` (default 60), and `maxBodyBytes` (default 8192). Attempts are limited across the whole plugin instance, including unknown usernames; one password check runs at a time. This does not rely on a spoofable forwarded client IP. Restart or plugin reload resets the attempt window. Throttling never disables the original token recovery path.

Run the password command again to change the password or username; new attempts read the record immediately. Existing signed sessions remain valid under upstream's cookie lifetime, including sessions created by token login. Password rotation is not session revocation. Retiring every session requires rotating the upstream browser-session signing credential using the upstream credential-management mechanism; do not delete the entire credentials file, which may contain model credentials.

`GET /auth/me` requires a valid original session cookie and returns `{"username":"admin","role":"admin"}` with the configured username. Both login methods have this same identity and full owner permissions. `POST /auth/logout` requires the session cookie and a same-origin `Origin` header; it expires the browser's `dsh-auth-*` cookies and redirects to the clean entry. Logout removes cookies from that browser; it does not revoke a copied cookie server-side. A same-origin browser client can call it with `fetch('./auth/logout', { method: 'POST' })`.

Password records missing or invalid at activation prevent this plugin from loading. A record removed or corrupted while running makes password login fail with a generic error; it never grants access. Connection still owns token authentication. The plugin serves its login form on `/`, delegates authenticated index rendering to the standard frontend resource at `/index.html`, and leaves other static resources and API routes to their upstream owners. It targets the standard Web profile, not Desktop or headless profiles.

For a remote deployment, keep the normal DSH Host/Origin allowlist and bind-address configuration. Use HTTPS at the listener or trusted reverse proxy; preserve `Host` and `Origin` and forward `/auth/*` as well as `/api/*` and WebSocket routes. A prefix proxy must strip the prefix before forwarding. This plugin neither opens firewall ports nor weakens Connection's trust checks. Cookie lifetime, persistence, signing, and native-TLS `Secure` attributes remain upstream-owned.

## Verify and update

The plugin has no npm dependencies or build step:

```sh
node --test custom/admin-auth/tests/*.test.mjs
```

Tests boot the real installed `dsh web` with temporary homes and passwords, then check successful password/token login, identical administrator identity, protected APIs, invalid credentials, CSRF checks, logout, password rotation, body limits, and throttling. Set `DSH_BIN` to an alternative dsh executable to test an updated installation. They do not require a model API key.

The focused CI workflow also runs `tests/browser-smoke.mjs` with Playwright 1.65.0. For local browser verification, install Playwright and Chromium outside this checkout, set `DSH_PLAYWRIGHT_MODULE` to Playwright's absolute `index.mjs` path, and run `node custom/admin-auth/tests/browser-smoke.mjs`. `DSH_CHROMIUM` optionally selects an existing Chromium executable; `DSH_BROWSER_ARTIFACTS` selects the screenshot directory. This checks native form submission, keyboard focus, mobile and landscape layouts, both themes, errors, password login, token login, and actual browser-cookie logout. Playwright is a test-only dependency; the plugin needs none.

This repository is a GitHub fork. Keep `origin` pointed at `Soufock/dsh` and add the official project as `upstream` once:

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
```

Synchronize on a clean worktree without rewriting your changes:

```sh
git fetch upstream master
git switch master
git merge upstream/master
# Install the official dsh version now declared in package.json.
node --test custom/admin-auth/tests/*.test.mjs
git push origin master
```

Custom code lives entirely under `custom/admin-auth/`; the only other fork addition is its focused CI workflow. Upstream files are untouched. There are no local changes to repeatedly reapply to Connection, BrowserAuth, or frontend-static. Tests deliberately exercise their public methods so incompatible upstream API or route changes are detected; zero merge conflicts do not guarantee runtime compatibility. Recheck the login page in a browser after updates, including mobile width, both color schemes, errors, password login, token login, and logout.

## Model experience

The plugin adds no tools, prompts, or model-visible context. Both login methods reach the existing owner Peer and share the same workspaces, sessions, and permissions. It does not implement multiple users or tenant isolation.
