import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const start = Date.now()

console.log('1/5 building...')
execFileSync('pnpm', ['run', 'build'], { cwd: cliRoot, stdio: 'inherit' })

console.log('2/5 packing...')
execFileSync('npm', ['pack', '--pack-destination', tmpdir()], { cwd: cliRoot, stdio: 'inherit' })
const tarball = readdirSync(tmpdir()).find((f) => f.startsWith('vadd-cli-') && f.endsWith('.tgz'))
if (!tarball) throw new Error('npm pack did not produce a vadd-cli-*.tgz in the tmp dir')
const tarballPath = join(tmpdir(), tarball)

console.log('3/5 installing into a scratch prefix...')
const prefix = mkdtempSync(join(tmpdir(), 'vadd-smoke-prefix-'))
const scratchHome = mkdtempSync(join(tmpdir(), 'vadd-smoke-home-'))
execFileSync('npm', ['install', '-g', '--prefix', prefix, tarballPath], { stdio: 'inherit' })

console.log('4/5 running the installed binary...')
const port = 14319
const child = spawn(join(prefix, 'bin', 'vadd'), [], {
  env: { ...process.env, HOME: scratchHome, VADD_PORT: String(port), VADD_WEB_DIST: '' },
  stdio: 'inherit',
})

try {
  await waitForPort(port, 30_000)
  const elapsedToListening = Date.now() - start

  console.log('5/5 driving a real project + objective through the HTTP API...')
  const repo = mkdtempSync(join(tmpdir(), 'vadd-smoke-repo-'))
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'smoke@vadd.local'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'smoke'])
  execFileSync(
    'sh',
    ['-c', `echo "# t" > README.md && git -C "${repo}" add -A && git -C "${repo}" commit -qm init`],
    { cwd: repo },
  )

  const projectRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repoPath: repo }),
  })
  if (!projectRes.ok) throw new Error(`project creation failed: ${projectRes.status}`)
  const project = (await projectRes.json()) as { id: string }

  const objectiveRes = await fetch(
    `http://127.0.0.1:${port}/api/projects/${project.id}/objectives`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'smoke test', goalText: 'prove the packaged binary works' }),
    },
  )
  if (!objectiveRes.ok) throw new Error(`objective creation failed: ${objectiveRes.status}`)

  console.log(`PASS. Server reached listening state in ${elapsedToListening}ms.`)
  console.log(
    'Note: this measures the server half only, from a cold install. The <5-minute DoD',
    'itself (a human clicking through the real browser) is not measured by this script —',
    'see the packaging design doc §4.',
  )
} finally {
  child.kill('SIGTERM')
  rmSync(prefix, { recursive: true, force: true })
  rmSync(scratchHome, { recursive: true, force: true })
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/projects`)
      if (res.status < 500) return
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server did not start listening on port ${port} within ${timeoutMs}ms`)
}
