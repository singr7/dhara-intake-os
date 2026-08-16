import type {
  AnswerSchema,
  AnswerType,
  ConfirmPolicy,
  LocalizedText,
  NodeType,
  SessionModeName,
} from '@dhara/contracts';
import type { ExpressionNode } from './expression/ast.js';
import type { ValueType } from './expression/typecheck.js';

/**
 * The compiled graph (doc 06 §7): the frozen, execution-ready form of a workflow document.
 *
 * It is produced once at publish time and stored in `workflow_versions.compiledGraph`, so
 * the runtime never re-parses an expression, never re-resolves a field reference, and never
 * needs the source document to serve a step. Two consequences shape the types below:
 *
 * 1. **Everything here is plain JSON.** No classes, no functions, no `RegExp` — it round
 *    trips through a JSONB column.
 * 2. **It is self-contained.** Anything the interpreter or the step-envelope builder (S04)
 *    needs is precomputed here, including per-node metadata the document only implies.
 */

export interface CompiledExpression {
  /** The author's original text, kept for error messages and studio round-tripping. */
  source: string;
  ast: ExpressionNode;
  /** Fields the expression reads — lets S04 re-evaluate only what a commit can affect. */
  reads: string[];
}

export interface CompiledTransition {
  /** `null` marks the unconditional fallthrough, which every transition list must end with. */
  when: CompiledExpression | null;
  /** A node id, or `$end`. */
  next: string;
}

/** How a node may be answered, derived from its effective mode (doc 07 §3 `modes`). */
export type InteractionMode = 'voice' | 'touch' | 'assisted';

export interface CompiledField {
  type: AnswerType;
  valueType: ValueType;
  required: boolean;
  retention?: 'standard' | 'sensitive';
}

export interface CompiledNode {
  id: string;
  type: NodeType;
  /** Ordered successors. Empty for terminal nodes. */
  transitions: CompiledTransition[];
  /** Distinct successor node ids, `$end` excluded — the adjacency map, for graph work. */
  edges: string[];
  terminal: boolean;
  mode: SessionModeName;
  modes: InteractionMode[];
  skippable: boolean;
  skipReason?: string;

  // question / computed / upload
  fieldKey?: string;
  /** Resolved answer schema: the node's override if it has one, else the field's. */
  answer?: AnswerSchema;
  required?: boolean;
  confirm?: ConfirmPolicy;
  prompt?: LocalizedText;
  helpText?: LocalizedText;
  promptAudio?: { recordingKey?: string; voice?: string; speed?: number };
  accept?: string[];
  maxFiles?: number;
  /** `computed` nodes only. */
  expr?: CompiledExpression;

  // handoff / end / action
  reason?: string;
  resumable?: boolean;
  outcome?: 'completed' | 'abandoned' | 'handed_off';
  label?: string;
  actionKind?: 'book' | 'reschedule' | 'cancel' | 'notify' | 'escalate';
  actionParams?: Record<string, CompiledExpression | string | number | boolean>;
  onFailure?: string;

  /**
   * Fields guaranteed committed on *every* path that reaches this node. The validator
   * computes it for the field-before-use check; S04 reuses it for progress estimates and
   * for deciding what a resumed session already knows.
   */
  committedBefore: string[];
}

export interface CompiledRedFlag {
  id: string;
  when: CompiledExpression;
  severity: 'low' | 'medium' | 'high';
  escalation: 'flag_only' | 'notify_review' | 'alert_staff_immediately';
  patientMessage?: LocalizedText;
  staffNote?: string;
}

export interface CompiledValidation {
  id: string;
  when: CompiledExpression;
  assert: CompiledExpression;
  message: LocalizedText;
  severity: 'block' | 'warn';
}

export interface CompiledGraph {
  dslVersion: string;
  /** The grammar/compiler build that produced this graph, for forward-compatibility checks. */
  compilerVersion: string;
  key: string;
  title: LocalizedText;
  languages: string[];
  /** `languages[0]` — the fallback for every missing string (doc 06 §6). */
  fallbackLanguage: string;
  defaultMode: SessionModeName;
  settings: {
    maxDurationSec: number;
    maxCostPaise: number;
    voiceFallbackAfterFailures: number;
    clarificationMaxAttempts: number;
  };
  consent: { purposeVersion: string; text: LocalizedText };
  startNodeId: string;
  /** Document order, which is also the order the studio and progress bar present. */
  order: string[];
  nodes: Record<string, CompiledNode>;
  terminalNodeIds: string[];
  fields: Record<string, CompiledField>;
  redFlags: CompiledRedFlag[];
  validations: CompiledValidation[];
  review: { alwaysReview: string[]; confidenceThreshold: number; reviewRequired: boolean };
  output: { schemaId: string; summaryTemplateId?: string; routingRule?: string };
  /** Count of question/upload nodes — the denominator of the runner's progress indicator. */
  questionCount: number;
}

/** Interaction modes a session mode permits (doc 07 §3). */
export function modesFor(mode: SessionModeName): InteractionMode[] {
  switch (mode) {
    case 'touch':
      return ['touch'];
    case 'conversational':
      return ['voice'];
    case 'assisted':
      return ['assisted', 'touch'];
    case 'hybrid':
    default:
      // Touch is always offered alongside voice: the fallback rung of the extraction ladder
      // is touch, so a hybrid node that cannot render a touch UI has no way to recover.
      return ['voice', 'touch'];
  }
}
