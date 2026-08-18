export const CORE_VERSION = '0.0.0'
export {
  evidenceComplete,
  isFastFix,
  userApproved,
} from './machine/guards.js'
export {
  type EvidenceItemLike,
  MACHINE_STATES,
  type MachineStateName,
  type PlanTaskLike,
  planTaskId,
  TERMINAL_STATES,
  toMachineEvent,
  type WorkflowContext,
  type WorkflowEvent,
} from './machine/types.js'
export {
  initialContext,
  type WorkflowInput,
  workflowMachine,
} from './machine/workflow-machine.js'
export { type CommandDecision, decideCommand } from './policies/command-policy.js'
export { fastFixPlanLooksSimple } from './policies/fast-fix-plan.js'
export { isProtectedPath, protectedPaths } from './policies/protected-paths.js'
export {
  type BudgetViolation,
  countWords,
  fitsReadingBudget,
  LEVEL_1_WORD_LIMIT,
  LEVEL_2_WORD_LIMIT,
} from './policies/reading-budget.js'
export {
  classifyTaskRisk,
  type RiskPolicyConfig,
  type TaskDiffSummary,
} from './policies/risk-policy.js'
export {
  assertSpecAllowed,
  mergeSpec,
  type SpecAllowed,
} from './policies/verification-resolution.js'
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
export { contractReference } from './schemas/contract-reference.js'
export { agentEventJsonSchema } from './schemas/json-schema.js'
export {
  normalizeChecks,
  VerificationOverride,
  VerificationSpec,
  type VerifyCommand,
} from './schemas/verification.js'
