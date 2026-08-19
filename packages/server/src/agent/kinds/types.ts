export type AgentKindConfig = {
  kind: 'claude-code' | 'codex'
  packageName: string
  missingAdapterMessage: string
  setupProfile(): { env: { CLAUDE_CONFIG_DIR: string } }
}
