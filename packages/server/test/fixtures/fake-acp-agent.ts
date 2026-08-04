/**
 * A scriptable ACP agent for testing AcpAgentPort. Speaks newline-delimited
 * JSON-RPC on stdio, exactly like claude-code-acp.
 *
 * Behaviour is driven by the FAKE_ACP_MODE environment variable:
 *   'normal'          — handshake, one message chunk, end_turn
 *   'permission'      — requests permission for FAKE_ACP_PATH before finishing
 *   'crash-on-prompt' — exits with code 3 when a prompt arrives
 */
import { createInterface } from 'node:readline'

const mode = process.env.FAKE_ACP_MODE ?? 'normal'
const permissionPath = process.env.FAKE_ACP_PATH ?? '/etc/passwd'

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

    const sessionId = (msg.params as { sessionId: string }).sessionId

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

    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
      },
    })

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
