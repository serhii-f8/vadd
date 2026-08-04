export const CORE_VERSION = '0.0.0'
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
