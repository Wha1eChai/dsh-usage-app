import { readFile, readdir } from 'node:fs/promises'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lib = join(root, 'lib')
const rc6 = '0.1.0-rc.6'
const clientExternals = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment', '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]
const expectedClientInject = [
  '@wha1echai/dsh-webpage',
  '@deepseek-ai/dsh-client-locale',
]
const packedAllowlist = [
  'package/package.json', 'package/README.md', 'package/LICENSE', 'package/NOTICE', 'package/cordis.patch.yml',
  'package/lib/index.js', 'package/lib/invariant.js', 'package/lib/client.js', 'package/lib/client.js.map',
  'package/lib/types/index.d.ts', 'package/lib/types/invariant.d.ts',
  'package/lib/types/fold.d.ts', 'package/lib/types/balances.d.ts', 'package/lib/types/subscriptions.d.ts',
  'package/lib/types/collect.d.ts', 'package/lib/types/http.d.ts',
  'package/lib/types/client/index.d.ts', 'package/lib/types/client/locales.d.ts',
  'package/lib/types/client/usage-view.d.ts', 'package/lib/types/client/UsageApp.d.ts',
].sort()

function fail(message) {
  throw new Error(`dsh-usage-app check failed: ${message}`)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function sourceFiles(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git' || entry.name === 'coverage') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await sourceFiles(path))
    else if (/\.(?:ts|tsx|css|mjs|json|yml|md)$/.test(entry.name)) result.push(path)
  }
  return result
}

async function assertManifest() {
  const manifest = await json(join(root, 'package.json'))
  assert(manifest.name === '@wha1echai/dsh-usage-app', 'package name changed')
  assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch is missing')
  assert(JSON.stringify(manifest.dsh?.client?.inject) === JSON.stringify(expectedClientInject), 'dsh.client.inject changed')
  for (const [name, version] of Object.entries({ ...manifest.peerDependencies, ...manifest.devDependencies })) {
    if (/^@deepseek-ai\/dsh(?:-|$)/.test(name)) assert(version === rc6 || String(version).startsWith('file:'), `${name} must be pinned to ${rc6}`)
    if (name === '@deepseek-ai/cordis') assert(version === '4.0.1', `${name} must be pinned to 4.0.1`)
  }
}

async function assertSources() {
  const files = await sourceFiles(root)
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    assert(!/[ \t]+\r?\n/.test(text), `trailing whitespace in ${file}`)
  }
  const preset = await readFile(join(root, 'tsdown.client.ts'), 'utf8')
  assert(preset.includes('codeSplitting: false'), 'client preset must disable code splitting')
  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  assert(patch.includes("name: '@wha1echai/dsh-usage-app'"), 'pack must list usage-app')
  assert(!patch.includes("name: '@wha1echai/dsh-webpage'"), 'must not re-insert webpage')
}

async function assertBuilt() {
  const clientPath = join(lib, 'client.js')
  assert(existsSync(join(lib, 'index.js')) && existsSync(clientPath), 'built artifacts are missing')
  const consumerRequire = createRequire(join(root, 'probe.cjs'))
  assert(consumerRequire.resolve('@wha1echai/dsh-usage-app') === join(lib, 'index.js'), 'root export does not resolve')
  const nodeModule = await import(`${pathToFileURL(join(lib, 'index.js')).href}?usage=${Date.now()}`)
  assert(JSON.stringify(Object.keys(nodeModule).sort()) === '["apply"]', `Node exports must be named apply only, got ${Object.keys(nodeModule)}`)
  const client = await readFile(clientPath, 'utf8')
  assert(client.includes('window.__ModuleLoader__.load'), 'client artifact lacks Loader handoff')
  const requireSpecifiers = [...client.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
  for (const specifier of requireSpecifiers) {
    assert(clientExternals.includes(specifier), `unresolvable external require(${JSON.stringify(specifier)})`)
  }
}

function locatePnpm() {
  const cli = process.env.npm_execpath
  if (typeof cli === 'string' && cli.length > 0 && existsSync(cli)) {
    try {
      const version = execFileSync(process.execPath, [cli, '--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
      if (version === '11.7.0') return { cli: resolve(cli), prefix: [] }
    } catch {
      // Nested pnpm 11.0.9 from `pnpm run` is not usable; fall through to Corepack.
    }
  }
  if (process.platform === 'win32') {
    const commands = execFileSync('where.exe', ['corepack.cmd'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    for (const command of commands) {
      const corepackCli = join(dirname(command), 'node_modules', 'corepack', 'dist', 'corepack.js')
      if (!existsSync(corepackCli)) continue
      const prefix = ['pnpm@11.7.0']
      const version = execFileSync(process.execPath, [corepackCli, ...prefix, '--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
      if (version === '11.7.0') return { cli: corepackCli, prefix }
    }
  }
  fail('could not locate pnpm 11.7.0 through npm_execpath or Corepack')
}

function assertPackedPayload() {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-usage-app-pack-'))
  try {
    const pnpm = locatePnpm()
    execFileSync(process.execPath, [pnpm.cli, ...pnpm.prefix, '--dir', root, 'pack', '--pack-destination', directory], { stdio: 'pipe' })
    const archives = readdirSync(directory).filter(file => file.endsWith('.tgz'))
    const tar = process.platform === 'win32' ? 'tar.exe' : 'tar'
    const files = execFileSync(tar, ['-tzf', join(directory, archives[0])], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).sort()
    assert(JSON.stringify(files) === JSON.stringify(packedAllowlist), `packed payload mismatch:\nexpected ${packedAllowlist.join(', ')}\nactual ${files.join(', ')}`)
    console.log(`Verified packed payload: ${archives[0]} (${files.length} files)`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const mode = process.argv.find(arg => arg.startsWith('--'))
await assertManifest()
if (mode === '--lint') {
  await assertSources()
  console.log('Usage App lint/source checks passed')
} else if (mode === '--pack') {
  await assertSources()
  await assertBuilt()
  assertPackedPayload()
  console.log('Usage App packed payload checks passed')
} else {
  fail(`unknown mode ${mode ?? '(none)'}`)
}
