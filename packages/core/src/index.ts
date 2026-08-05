export const CORE_VERSION = '0.0.0'
export { type CommandDecision, decideCommand } from './policies/command-policy.js'
export {
  type BudgetViolation,
  countWords,
  fitsReadingBudget,
  LEVEL_1_WORD_LIMIT,
  LEVEL_2_WORD_LIMIT,
} from './policies/reading-budget.js'
export type { AgentPort, RawAgentUpdate } from './ports/agent-port.js'
export {
  AGENT_EVENT_TYPES,
  AgentEvent,
  type AgentEventType,
  EvidenceKind,
  EvidenceStatus,
  Phase,
} from './schemas/agent-event.js'
export {
  CreateObjectiveBody,
  ObjectiveCommand,
  RegisterProjectBody,
} from './schemas/api.js'
export { agentEventJsonSchema } from './schemas/json-schema.js'
