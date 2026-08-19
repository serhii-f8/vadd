import { ensureAgentProfile } from '../profile.js'
import type { AgentKindConfig } from './types.js'

export function claudeCodeConfig(): AgentKindConfig {
  return {
    kind: 'claude-code',
    packageName: '@zed-industries/claude-code-acp',
    missingAdapterMessage:
      'Cannot find the Claude Code ACP adapter. Install it with: pnpm add -Dw @zed-industries/claude-code-acp@0.16.2',
    setupProfile: () => ({
      // Isolation, not preference: with the user's global ~/.claude in scope,
      // third-party skills load into VADD sessions and contaminate the eval
      // corpus the M1 gate reads (vadd-spec-phase2.md §2) — the exact
      // reasoning AgentRegistry's old inline factory already carried.
      env: { CLAUDE_CONFIG_DIR: ensureAgentProfile() },
    }),
  }
}
