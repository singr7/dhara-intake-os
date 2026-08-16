import { END_NODE_REF } from '@dhara/contracts';
import type { CompiledGraph, CompiledNode, CompiledRedFlag } from './compiled.js';
import {
  evaluateCondition,
  evaluateExpression,
  type EvaluationContext,
  type FieldValue,
} from './expression/evaluate.js';

/**
 * The interpreter core: pure functions over a compiled graph and a set of committed fields.
 *
 * "Pure" is a hard constraint, not a style preference. The session engine (S04) owns state,
 * evidence writes and I/O; this module owns *what the workflow says should happen next*.
 * Keeping them apart is what makes the traversal replayable — feed the same committed
 * fields to the same graph and you get the same path, which is what the eval harness (S18)
 * and any "why did this intake go there?" investigation depend on.
 */

export type CommittedFields = Readonly<Record<string, FieldValue>>;

export interface TraversalOptions {
  /** Injected clock, so `ageYears()` is stable across a replay. */
  now?: Date;
}

export type NextNodeResult =
  | { kind: 'node'; nodeId: string; node: CompiledNode }
  /** The traversal reached `$end` or a node with no outgoing transition. */
  | { kind: 'end'; outcome: 'completed' | 'abandoned' | 'handed_off' };

function context(fields: CommittedFields, options: TraversalOptions): EvaluationContext {
  return { f: fields, ...(options.now ? { now: options.now } : {}) };
}

export function getNode(graph: CompiledGraph, nodeId: string): CompiledNode {
  const node = graph.nodes[nodeId];
  if (!node) throw new Error(`node \`${nodeId}\` is not in this compiled graph`);
  return node;
}

/** The node an intake starts on. */
export function startNode(graph: CompiledGraph): CompiledNode {
  return getNode(graph, graph.startNodeId);
}

/**
 * Resolves the successor of `currentNodeId` given what has been committed.
 *
 * Transitions are evaluated in document order and the first matching `when` wins; the
 * unconditional entry the validator insists on is what guarantees this function always has
 * an answer. `branch` nodes are resolved transparently — the caller is handed the next node
 * a *patient* sees, not the routing node in between, because a branch is a compiler concept
 * and has no step envelope.
 */
export function nextNode(
  graph: CompiledGraph,
  committedFields: CommittedFields,
  currentNodeId: string,
  options: TraversalOptions = {},
): NextNodeResult {
  const ctx = context(committedFields, options);
  const seen = new Set<string>();
  let current = getNode(graph, currentNodeId);

  for (;;) {
    if (current.terminal && current.transitions.length === 0) {
      return { kind: 'end', outcome: current.outcome ?? 'completed' };
    }

    const taken = current.transitions.find(
      (transition) => transition.when === null || evaluateCondition(transition.when.ast, ctx),
    );
    // The validator guarantees a final unconditional entry, so a missing one means the
    // graph was hand-edited past the compiler.
    if (!taken) {
      throw new Error(
        `node \`${current.id}\` has no matching transition — the compiled graph is malformed`,
      );
    }

    if (taken.next === END_NODE_REF) return { kind: 'end', outcome: 'completed' };

    const target = getNode(graph, taken.next);
    if (target.type !== 'branch') {
      return { kind: 'node', nodeId: target.id, node: target };
    }

    // Chained branches are legal and useful; a loop between them is not, and the validator
    // rejects cycles — this guard exists so a hand-edited graph fails loudly instead of hanging.
    if (seen.has(target.id)) {
      throw new Error(`branch nodes loop at \`${target.id}\` — the compiled graph is malformed`);
    }
    seen.add(target.id);
    current = target;
  }
}

export interface RaisedRedFlag {
  id: string;
  severity: CompiledRedFlag['severity'];
  escalation: CompiledRedFlag['escalation'];
  patientMessage?: CompiledRedFlag['patientMessage'];
  staffNote?: string;
}

/**
 * Evaluates every red-flag rule against the committed fields (doc 06 §5).
 *
 * Called after every `field.committed`, so it re-runs the whole rule set rather than only
 * the rules touching the new field: rules are cheap, and a rule that fires only when
 * evaluated in the right order is a rule nobody can reason about. Results come back in
 * severity order so the caller can act on the worst one without sorting.
 */
export function evaluateRedFlags(
  graph: CompiledGraph,
  committedFields: CommittedFields,
  options: TraversalOptions = {},
): RaisedRedFlag[] {
  const ctx = context(committedFields, options);
  const severityRank = { high: 0, medium: 1, low: 2 } as const;

  return graph.redFlags
    .filter((flag) => evaluateCondition(flag.when.ast, ctx))
    .map((flag) => ({
      id: flag.id,
      severity: flag.severity,
      escalation: flag.escalation,
      ...(flag.patientMessage ? { patientMessage: flag.patientMessage } : {}),
      ...(flag.staffNote ? { staffNote: flag.staffNote } : {}),
    }))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export interface ValidationBreach {
  id: string;
  severity: 'block' | 'warn';
  message: Record<string, string>;
}

/** Evaluates the cross-field validations (doc 06 §4): `when` holds but `assert` does not. */
export function evaluateValidations(
  graph: CompiledGraph,
  committedFields: CommittedFields,
  options: TraversalOptions = {},
): ValidationBreach[] {
  const ctx = context(committedFields, options);
  return graph.validations
    .filter(
      (rule) => evaluateCondition(rule.when.ast, ctx) && !evaluateCondition(rule.assert.ast, ctx),
    )
    .map((rule) => ({ id: rule.id, severity: rule.severity, message: rule.message }));
}

/** Evaluates a `computed` node's expression, producing the value to commit. */
export function evaluateComputed(
  graph: CompiledGraph,
  nodeId: string,
  committedFields: CommittedFields,
  options: TraversalOptions = {},
): unknown {
  const node = getNode(graph, nodeId);
  if (node.type !== 'computed' || !node.expr) {
    throw new Error(`node \`${nodeId}\` is not a computed node`);
  }
  // Not `evaluateCondition`: a computed field may be of any type, not just yes/no.
  return evaluateExpression(node.expr.ast, context(committedFields, options));
}

/**
 * Picks the best text for a language, falling back to the document's first language
 * (doc 06 §6). The validator warns about the gap; the runtime must still show something.
 */
export function localize(
  text: Record<string, string> | undefined,
  language: string,
  fallbackLanguage: string,
): string | undefined {
  if (!text) return undefined;
  return text[language] ?? text[fallbackLanguage] ?? Object.values(text)[0];
}
