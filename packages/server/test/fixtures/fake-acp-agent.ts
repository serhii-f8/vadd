/**
 * A scriptable ACP agent for testing AcpAgentPort. Speaks newline-delimited
 * JSON-RPC on stdio, exactly like claude-code-acp.
 *
 * Behaviour is driven by the FAKE_ACP_MODE environment variable:
 *   'normal'          — handshake, one message chunk, end_turn
 *   'contract'        — streams one vadd-event block split across three chunks
 *   'permission'         — requests permission for FAKE_ACP_PATH before finishing
 *   'permission-command' — requests permission for a command (FAKE_ACP_COMMAND)
 *                          instead of a path, via toolCall.rawInput.command
 *   'crash-on-prompt'    — exits with code 3 when a prompt arrives
 *   'repair-succeeds'    — first turn owes evidence; the repair prompt supplies it
 *   'repair-fails'       — first turn owes evidence; the repair prompt does not
 *   'satisfied'          — one turn emitting both evidence and task_result, owing nothing
 *   'dangling-ref'          — first turn's task_result cites evidence it never
 *                             emitted; the repair prompt does not resolve it
 *   'dangling-ref-repaired' — same first turn; the repair prompt supplies the
 *                             cited evidence
 */
import { createInterface } from 'node:readline'

const mode = process.env.FAKE_ACP_MODE ?? 'normal'
const permissionPath = process.env.FAKE_ACP_PATH ?? '/etc/passwd'
const permissionCommand = process.env.FAKE_ACP_COMMAND ?? 'sudo rm -rf /'
let promptCount = 0

function send(msg: unknown) {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

let nextId = 1000
const pending = new Map<number, (result: unknown) => void>()

function request(method: string, params: unknown): Promise<unknown> {
  const id = nextId++
  send({ jsonrpc: '2.0', id, method, params })
  return new Promise((resolve) => pending.set(id, resolve))
}

const rl = createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line) as {
    id?: number
    method?: string
    params?: Record<string, unknown>
    result?: unknown
  }

  // A response to something we asked the client.
  if (msg.id !== undefined && msg.method === undefined) {
    pending.get(msg.id)?.(msg.result)
    pending.delete(msg.id)
    return
  }

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] },
    })
    return
  }

  if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'fake-session-1' } })
    return
  }

  if (msg.method === 'session/prompt') {
    if (mode === 'crash-on-prompt') process.exit(3)
    // Accept the turn and never answer it — a long-running turn, which is the
    // normal case a discard or shutdown interrupts.
    if (mode === 'hang-on-prompt') return

    const sessionId = (msg.params as { sessionId: string }).sessionId

    // Repair modes: the first answer owes an `evidence` event, the second is
    // the repair's answer. `repair-succeeds` supplies it; `repair-fails` does
    // not, which is how the no-recursion case is exercised.
    if (mode === 'repair-succeeds' || mode === 'repair-fails') {
      promptCount += 1
      const first =
        '```vadd-event\n{"type":"task_result","taskId":"t","claim":"done","evidenceRefs":[]}\n```\n'
      const second =
        mode === 'repair-succeeds'
          ? '```vadd-event\n{"type":"evidence","kind":"test","status":"pass","headline":"OK (1 test)","summary":[]}\n```\n'
          : 'still nothing to show\n'
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: promptCount === 1 ? first : second },
          },
        },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    if (mode === 'dangling-ref' || mode === 'dangling-ref-repaired') {
      promptCount += 1
      const first =
        '```vadd-event\n{"type":"evidence","kind":"lint","status":"pass","headline":"Pint passed","summary":[]}\n```\n' +
        '```vadd-event\n{"type":"task_result","taskId":"t","claim":"done","evidenceRefs":["OK (1 test)"]}\n```\n'
      const second =
        mode === 'dangling-ref-repaired'
          ? '```vadd-event\n{"type":"evidence","kind":"test","status":"pass","headline":"OK (1 test)","summary":[]}\n```\n'
          : 'still nothing to show\n'
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: promptCount === 1 ? first : second },
          },
        },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    if (mode === 'satisfied') {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text:
                '```vadd-event\n{"type":"evidence","kind":"test","status":"pass","headline":"OK (1 test)","summary":[]}\n```\n' +
                '```vadd-event\n{"type":"task_result","taskId":"t","claim":"done","evidenceRefs":["OK (1 test)"]}\n```\n',
            },
          },
        },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    if (mode === 'fs-write-outside') {
      // Exercises the client's fs/write_text_file callback, which enforces
      // containment separately from session/request_permission.
      await request('fs/write_text_file', {
        sessionId,
        path: permissionPath,
        content: 'stolen',
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    if (mode === 'permission-always-only') {
      // Offers ONLY the "always" variants. A client that falls back to
      // allow_always here would hand this adapter a session-wide grant; the
      // policy must decline instead. The outcome is echoed back as an update so
      // the test can assert what the client actually chose.
      const outcome = await request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 'fake-tc-1', locations: [{ path: permissionPath }] },
        options: [
          { optionId: 'yes-always', name: 'Allow always', kind: 'allow_always' },
          { optionId: 'no-always', name: 'Reject always', kind: 'reject_always' },
        ],
      })
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId, update: { sessionUpdate: 'permission_outcome', outcome } },
      })
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
      return
    }

    if (mode === 'permission') {
      await request('session/request_permission', {
        sessionId,
        // toolCallId is required by the pinned agent-client-protocol@0.4.5
        // client's request schema — omitting it makes the client reject the
        // request at the transport layer before AcpAgentPort ever sees it.
        toolCall: { toolCallId: 'fake-tc-1', locations: [{ path: permissionPath }] },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      })
    }

    if (mode === 'permission-command') {
      await request('session/request_permission', {
        sessionId,
        toolCall: {
          toolCallId: 'fake-tc-1',
          rawInput: { command: permissionCommand },
        },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      })
    }

    if (mode === 'contract') {
      // Streams one vadd-event block split across three chunks, so the
      // pipeline's cross-chunk fence handling is exercised, not just the
      // single-chunk case.
      const parts = [
        'Working on it.\n```vadd-e',
        'vent\n{"type":"status","phase":"exec',
        'uting","headline":"Running the suite"}\n```\n',
      ]
      for (const text of parts) {
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
          },
        })
      }
    } else {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'hello' },
          },
        },
      })
    }

    if (mode === 'odd-raw-output') {
      // The two rawOutput shapes claude-code-acp@0.16.2 really sends and the
      // pinned SDK's `z.record(z.unknown())` really rejects. The SDK parses
      // before dispatching, so an unrelaxed client drops both silently.
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'fake-tc-1',
            status: 'completed',
            rawOutput: ['an', 'array'],
          },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'fake-tc-2',
            status: 'failed',
            rawOutput: 'Editing file failed: The provided `old_string` does not appear in the file',
          },
        },
      })
    }
    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } })
    return
  }

  if (msg.method === 'session/cancel') {
    // Notification: no response.
    return
  }

  if (msg.id !== undefined) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } })
  }
})
