/** Administrator password records, stored separately from the source checkout. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** @returns {string} The administrator record under the configured Harness home. */
export function defaultCredentialFile() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'admin-auth.json')
}

/**
 * Load a validated password hash; missing or malformed configuration fails closed.
 * @param {string} path Administrator record path.
 * @returns {Promise<{version: 1, username: string, salt: string, hash: string}>} Record.
 */
export async function loadCredentials(path) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (value?.version !== 1 || typeof value.username !== 'string'
    || !/^[a-zA-Z0-9_.@-]{1,64}$/u.test(value.username)
    || typeof value.salt !== 'string' || !/^[a-f0-9]{32}$/u.test(value.salt)
    || typeof value.hash !== 'string' || !/^[a-f0-9]{128}$/u.test(value.hash)) {
    throw new Error('Invalid administrator password record; run the admin-auth password command')
  }
  return value
}

/**
 * Atomically create or replace a salted scrypt record with owner-only permissions.
 * @param {string} path Administrator record path.
 * @param {string} username Administrator name.
 * @param {string} password New password, 12–1024 UTF-8 bytes.
 * @returns {Promise<void>} Resolves after publication.
 */
export async function saveCredentials(path, username, password) {
  if (!/^[a-zA-Z0-9_.@-]{1,64}$/u.test(username)) throw new Error('Use 1–64 letters, digits, or _.@- for the username')
  const bytes = Buffer.byteLength(password)
  if (bytes < 12 || bytes > 1024) throw new Error('Password must contain 12–1024 UTF-8 bytes')
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, Buffer.from(salt, 'hex'), 64, OPTIONS)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, username, salt, hash: hash.toString('hex') }) + '\n', { mode: 0o600, flag: 'wx' })
    await chmod(temporary, 0o600)
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/**
 * Check both fields without skipping the password KDF for an unknown username.
 * @param {{username: string, salt: string, hash: string}} record Validated record.
 * @param {string} username Submitted name.
 * @param {string} password Submitted password.
 * @returns {Promise<boolean>} Whether both credentials match.
 */
export async function verifyCredentials(record, username, password) {
  const actual = await scrypt(password, Buffer.from(record.salt, 'hex'), 64, OPTIONS)
  const passwordMatches = timingSafeEqual(actual, Buffer.from(record.hash, 'hex'))
  return passwordMatches && username === record.username
}
