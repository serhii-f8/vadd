/**
 * A single update received from the agent, untouched.
 *
 * `update` is deliberately `unknown` in M0: the ACP SDK's types stay inside
 * the server's adapter, and M1's Output Contract pipeline is the first code
 * that narrows this. Do not add fields here to make M1 easier — M1 adds a
 * transform over `onUpdate`, not a wider interface.
 */
export type RawAgentUpdate = {
  sessionId: string
  receivedAt: string
  update: unknown
}

export interface AgentPort {
  /** Spawn the adapter process and complete the initialize handshake. */
  start(): Promise<void>
  /** Open a conversation rooted at `cwd` (an objective's worktree). */
  newSession(o: { cwd: string }): Promise<{ sessionId: string }>
  /** Send a user turn and resolve when the agent stops. */
  prompt(sessionId: string, text: string): Promise<{ stopReason: string }>
  /** Ask the agent to abandon the current turn. */
  cancel(sessionId: string): Promise<void>
  /** Terminate the adapter process. Safe to call twice. */
  stop(): Promise<void>
  /** Subscribe to raw updates. Returns an unsubscribe function. */
  onUpdate(cb: (u: RawAgentUpdate) => void): () => void
}
