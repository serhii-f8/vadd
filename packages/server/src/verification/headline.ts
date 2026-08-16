import { clip } from './setup.js'

const MATCHERS: RegExp[] = [
  /OK \(\d+ tests?, \d+ assertions?\)/, // PHPUnit
  /Tests\s+\d+ passed[^\n]*/, // vitest
  /\d+ problems? \(\d+ errors?, \d+ warnings?\)/, // eslint
  /\d+ passed[^\n]*/, // jest and friends
]

const WARNING = /\b(\d+) warnings?\b/

/**
 * Design §5.3. Deliberately small: a headline is a Level 1 string, and an
 * unrecognised suite gets an honest generic line rather than a guessed one.
 */
export function headlineFor(commandId: string, exitCode: number, output: string): string {
  if (exitCode !== 0) return clip(`${commandId} failed — exit ${exitCode}`, 120)
  for (const matcher of MATCHERS) {
    const hit = matcher.exec(output)
    if (hit) return clip(hit[0].trim(), 120)
  }
  return clip(`${commandId} passed`, 120)
}

/** Design §5.2: `warn` is exit 0 with warnings in the output — eslint's shape. */
export function sawWarnings(output: string): boolean {
  const hit = WARNING.exec(output)
  return hit?.[1] !== undefined && Number(hit[1]) > 0
}
