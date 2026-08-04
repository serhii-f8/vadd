import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@zed-industries/agent-client-protocol'
import { execa } from 'execa'

// DEVIATION FROM BRIEF (see docs/superpowers/notes/acp-handshake.md, "Deviation" section):
// The brief's spawn used `spawn('npx', ['claude-code-acp'], { cwd: repo })`. Because `repo`
// is a scratch dir outside the workspace (no node_modules), npx cannot find the pinned local
// binary there, falls back to the npm registry, and silently installs+runs an unrelated
// public package also named `claude-code-acp` (0.1.1, not our pinned
// @zed-industries/claude-code-acp@0.16.2). We instead resolve the pinned package's own bin
// path from its package.json and spawn that directly with `node`, so the spike actually
// exercises the pinned dependency. This is recorded as a load-bearing finding for Task 10:
// AcpAgentPort must not rely on npx's cwd-relative bin resolution when the child cwd is a
// git worktree outside the main repo.
const acpPkgUrl = import.meta.resolve('@zed-industries/claude-code-acp/package.json')
const acpPkg = JSON.parse(await readFile(new URL(acpPkgUrl), 'utf8'))
const acpBin = new URL(acpPkg.bin['claude-code-acp'], acpPkgUrl)

// `archive/`, not the top level: `evals/transcripts/*.jsonl` is the gate's
// corpus listing, and a spike capture dropped there fails `pnpm eval` (or, if
// someone labelled it, contaminates the kill-switch number).
const outDir = join('evals', 'transcripts', 'archive')
const outFile = join(outDir, `spike-${Date.now()}.jsonl`)
mkdirSync(outDir, { recursive: true })

function record(kind: string, data: unknown) {
  appendFileSync(outFile, `${JSON.stringify({ kind, at: new Date().toISOString(), data })}\n`)
  console.log(`[${kind}]`, JSON.stringify(data).slice(0, 400))
}

// A scratch git repo so the agent has somewhere real to work.
const repo = mkdtempSync(join(tmpdir(), 'vadd-spike-'))
await execa('git', ['-C', repo, 'init', '-q'])
writeFileSync(join(repo, 'README.md'), '# spike\n')
await execa('git', ['-C', repo, 'add', '-A'])
await execa('git', [
  '-C',
  repo,
  '-c',
  'user.email=s@x',
  '-c',
  'user.name=s',
  'commit',
  '-qm',
  'init',
])

// This spike is itself run from inside a Claude Code session, and claude-code-acp refuses
// to launch when it detects CLAUDECODE in its environment ("nested sessions share runtime
// resources and will crash all active sessions"). The tool's own error message names
// CLAUDECODE as the bypass. In production, Task 10's AcpAgentPort runs inside the VADD
// server process (not inside a Claude Code session), so this will not apply there.
const { CLAUDECODE: _unused, ...childEnv } = process.env

const child = spawn(process.execPath, [acpBin.pathname], {
  cwd: repo,
  env: childEnv,
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stderr.on('data', (b: Buffer) => record('stderr', b.toString()))
child.on('exit', (code, signal) => record('child_exit', { code, signal }))

// ndJsonStream(output, input): output = child stdin, input = child stdout.
const stream = ndJsonStream(
  Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
  Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
)

const conn = new ClientSideConnection(
  () => ({
    async sessionUpdate(params) {
      record('session_update', params)
    },
    async requestPermission(params) {
      record('request_permission', params)
      const allow = params.options.find((o) => o.kind === 'allow_once') ?? params.options[0]
      if (!allow) return { outcome: { outcome: 'cancelled' } }
      return { outcome: { outcome: 'selected', optionId: allow.optionId } }
    },
    async readTextFile(params) {
      record('read_text_file', params)
      const { readFileSync } = await import('node:fs')
      return { content: readFileSync(params.path, 'utf8') }
    },
    async writeTextFile(params) {
      record('write_text_file', params)
      writeFileSync(params.path, params.content)
      return {}
    },
  }),
  stream,
)

const init = await conn.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
})
record('initialize_response', init)

const session = await conn.newSession({ cwd: repo, mcpServers: [] })
record('new_session_response', session)

const result = await conn.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: 'Add a line saying "hello from vadd" to README.md, then stop.' }],
})
record('prompt_response', result)

child.kill('SIGTERM')
console.log(`\nTranscript: ${outFile}\nScratch repo: ${repo}`)
