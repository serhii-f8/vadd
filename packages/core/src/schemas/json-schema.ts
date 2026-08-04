import { zodToJsonSchema } from 'zod-to-json-schema'
import { AgentEvent } from './agent-event.js'

/**
 * Recursively pins `additionalProperties: false` on every object.
 *
 * Two consumers need it: the prompt contract, where it tells the agent not to
 * invent fields, and the structured-output path in the summarizer, which
 * rejects a schema without it.
 */
function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = closeObjects(v)
  if (out.type === 'object' && out.additionalProperties === undefined) {
    out.additionalProperties = false
  }
  return out
}

/**
 * JSON Schema for `AgentEvent`, generated from the Zod union.
 *
 * `$refStrategy: 'none'` inlines every definition: the schema is pasted into a
 * prompt, where a `$ref` the model has to resolve is a comprehension tax for
 * no benefit.
 */
export function agentEventJsonSchema(): Record<string, unknown> {
  return closeObjects(
    zodToJsonSchema(AgentEvent, { name: 'AgentEvent', $refStrategy: 'none' }),
  ) as Record<string, unknown>
}
