export type AgentKindConfig = {
  kind: 'claude-code' | 'codex'
  packageName: string
  missingAdapterMessage: string
  setupProfile(): { env: Record<string, string> }
}
