import { agentEventJsonSchema } from './json-schema.js'

type JsonSchemaNode = {
  type?: string
  const?: string
  enum?: string[]
  maxLength?: number
  maxItems?: number
  minItems?: number
  items?: JsonSchemaNode
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  /** A nested discriminated union — `artifact.cards[]` is the first. */
  anyOf?: JsonSchemaNode[]
}

/** `string, at most 80 chars` — the constraint half of one field's line. */
function describe(node: JsonSchemaNode): string {
  if (node.const !== undefined) return `exactly ${JSON.stringify(node.const)}`
  if (node.enum) return `one of ${node.enum.join(' | ')}`
  if (node.type === 'array') {
    const item = node.items ?? {}
    // "array of string, at most 100 chars, at most 5 items" reads as though the
    // 100 bounds the array. Since the whole point of this reference is that the
    // agent obeys caps it can only learn here, the per-item cap is stated as
    // per-item: "at most 5 strings, each at most 100 chars".
    const { minItems: min, maxItems: max } = node
    let count = ''
    if (min !== undefined && max !== undefined)
      count = min === max ? `exactly ${min} ` : `${min}–${max} `
    else if (max !== undefined) count = `at most ${max} `
    else if (min !== undefined) count = `at least ${min} `

    const noun =
      item.anyOf !== undefined
        ? 'objects, one of the kinds below'
        : item.type === 'object'
          ? `objects { ${Object.keys(item.properties ?? {}).join(', ')} }`
          : item.type === 'array'
            ? 'arrays'
            : item.type === 'string'
              ? 'strings'
              : `${item.type ?? 'value'}s`

    const each =
      item.enum !== undefined
        ? `, each one of ${item.enum.join(' | ')}`
        : item.type === 'string' && item.maxLength !== undefined
          ? `, each at most ${item.maxLength} chars`
          : ''

    return `array of ${count}${noun}${each}`
  }
  if (node.type === 'object') {
    return `object { ${Object.keys(node.properties ?? {}).join(', ')} }`
  }
  if (node.type === 'string' && node.maxLength !== undefined) {
    return `string, at most ${node.maxLength} chars`
  }
  return node.type ?? 'value'
}

function fieldLines(variant: JsonSchemaNode, indent: string, skip = 'type'): string[] {
  const required = new Set(variant.required ?? [])
  const lines: string[] = []
  for (const [name, node] of Object.entries(variant.properties ?? {})) {
    if (name === skip) continue
    const need = required.has(name) ? 'required' : 'optional'
    lines.push(`${indent}- \`${name}\` (${need}): ${describe(node)}`)
    const item = node.type === 'array' ? node.items : undefined
    if (item?.type === 'object') lines.push(...fieldLines(item, `${indent}  `))
    // A nested discriminated union (`artifact.cards[]`): one sub-block per
    // kind, its own discriminator named on the heading line and skipped in
    // the field list, so the agent learns every card kind's fields and caps
    // here — the only place it can.
    if (item?.anyOf !== undefined) {
      for (const sub of item.anyOf) {
        const kind = sub.properties?.kind?.const
        if (kind === undefined) continue
        lines.push(`${indent}  - kind \`${kind}\`:`)
        lines.push(...fieldLines(sub, `${indent}    `, 'kind'))
      }
    }
  }
  return lines
}

/**
 * The `AgentEvent` contract as compact Markdown, generated from the same JSON
 * Schema export the prompt contract uses.
 *
 * This exists because the agent never had the schema. `system-addendum.md`
 * told it to "match the schema in `agent-event.schema.json`", a file generated
 * into the VADD repo and unreachable from a worktree under an isolated
 * `CLAUDE_CONFIG_DIR`. Every `maxLength` bound, and the required-field list for
 * the four types no template exemplifies, lived only there.
 *
 * Generated rather than written so it satisfies the architecture rule the
 * addendum's hand-copied rules broke: Zod is the single source of truth, and
 * the contract is exported from it, never transcribed a second time.
 */
export function contractReference(): string {
  const schema = agentEventJsonSchema() as {
    definitions?: { AgentEvent?: { anyOf?: JsonSchemaNode[] } }
  }
  const variants = schema.definitions?.AgentEvent?.anyOf ?? []
  const out: string[] = []
  for (const variant of variants) {
    const name = variant.properties?.type?.const
    if (name === undefined) continue
    out.push(`### ${name}`, ...fieldLines(variant, ''), '')
  }
  return out.join('\n').trimEnd()
}
