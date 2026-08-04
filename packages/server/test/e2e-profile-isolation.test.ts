import { expect, test } from 'vitest'
import { AcpAgentPort } from '../src/agent/acp-agent-port.js'
import { ensureAgentProfile, PROFILE_CANARY } from '../src/agent/profile.js'
import { makeTempRepo, withTempHome } from './fixtures/temp-repo.js'

const run = process.env.VADD_E2E === '1' ? test : test.skip

/**
 * The one check that cannot be faked with the fake ACP peer: whether the real
 * adapter honours CLAUDE_CONFIG_DIR. If this fails, STOP — every transcript
 * recorded afterwards is contaminated and the gate is meaningless.
 */
run(
  "the real adapter reads VADD's profile and not the user's",
  async () => {
    withTempHome()
    const repo = makeTempRepo()
    const port = new AcpAgentPort({
      worktreePath: repo,
      env: { CLAUDE_CONFIG_DIR: ensureAgentProfile() },
    })

    let text = ''
    port.onUpdate((u) => {
      const up = u.update as { sessionUpdate?: string; content?: { type?: string; text?: string } }
      if (up?.sessionUpdate === 'agent_message_chunk' && up.content?.type === 'text') {
        text += up.content.text
      }
    })

    try {
      await port.start()
      const { sessionId } = await port.newSession({ cwd: repo })
      await port.prompt(
        sessionId,
        'What is the profile canary? Then list the names of any skills or plugins available to you.',
      )
    } finally {
      await port.stop()
    }

    // Positive: our generated CLAUDE.md was read.
    expect(text).toContain(PROFILE_CANARY)
    // Negative: the developer's global skills were not. Best-effort — it proves
    // absence of these names, not of every possible third-party skill.
    for (const foreign of ['superpowers', 'brainstorming', 'systematic-debugging']) {
      expect(text.toLowerCase()).not.toContain(foreign)
    }
  },
  120_000,
)
