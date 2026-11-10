/** Interactive administrator password setup; never accepts passwords through argv. */
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { defaultCredentialFile, saveCredentials } from './credentials.mjs'

async function main() {
  const args = process.argv.slice(2)
  let file = defaultCredentialFile()
  let username = 'admin'
  let fromStdin = false
  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    if (option === '--file' && args[index + 1]) file = resolve(args[++index])
    else if (option === '--username' && args[index + 1]) username = args[++index]
    else if (option === '--password-stdin') fromStdin = true
    else throw new Error('Usage: node password.mjs [--username admin] [--file /path/admin-auth.json] [--password-stdin]')
  }
  let password
  if (fromStdin) {
    const chunks = []
    let bytes = 0
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > 1026) throw new Error('Password input exceeds 1024 bytes plus its final newline')
      chunks.push(chunk)
    }
    password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/u, '')
  } else {
    if (!process.stdin.isTTY) throw new Error('Use --password-stdin when not running in a terminal')
    const muted = new Writable({ write(_chunk, _encoding, done) { done() } })
    const input = createInterface({ input: process.stdin, output: muted, terminal: true })
    try {
      process.stdout.write('New administrator password (at least 12 bytes): ')
      password = await input.question('')
      process.stdout.write('\nConfirm password: ')
      const confirmation = await input.question('')
      process.stdout.write('\n')
      if (password !== confirmation) throw new Error('Passwords do not match')
    } finally { input.close() }
  }
  await saveCredentials(file, username, password)
  process.stdout.write(`Administrator ${username} saved to ${file}\n`)
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
