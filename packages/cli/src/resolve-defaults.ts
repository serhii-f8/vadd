import { join } from 'node:path'

export function resolveDefaults(here: string) {
  return {
    migrationsDir: join(here, 'migrations'),
    promptsDir: join(here, 'prompts', 'claude-code', 'v1'),
    webDist: join(here, 'web'),
  }
}
