import {
  END_NODE_REF,
  workflowDocumentSchema,
  type AnswerSchema,
  type DslNode,
  type LocalizedText,
  type WorkflowDocument,
} from '@dhara/contracts';
import { DSL_GRAMMAR_VERSION } from './version.js';
import { scanForDeniedLanguage, type DenyScope } from './denylist.js';
import { referencedFields, type ExpressionNode } from './expression/ast.js';
import { ExpressionSyntaxError, parseExpression } from './expression/parse.js';
import {
  typeCheckCondition,
  typeCheckExpression,
  valueTypeByAnswerType,
  type ValueType,
} from './expression/typecheck.js';
import {
  modesFor,
  type CompiledExpression,
  type CompiledGraph,
  type CompiledNode,
  type CompiledTransition,
} from './compiled.js';

/**
 * `validate(doc)` — the compiler contract of doc 06 §7.
 *
 * The checks are ordered so that each one can assume the previous ones passed: shape, then
 * references, then expressions, then graph topology, then dataflow, then language and
 * safety. When an early stage fails the later ones are skipped rather than run against
 * nonsense, because twenty cascading errors from one typo is worse than one.
 *
 * Every issue carries a JSON pointer into the document, so the studio (M5) can put the
 * message next to the thing that is wrong, and a human-readable message that says what to
 * do — not `expected string, received number`.
 */

export type IssueCode =
  | 'shape'
  | 'duplicate-node-id'
  | 'unknown-field'
  | 'unused-field'
  | 'answer-type-mismatch'
  | 'unknown-node-ref'
  | 'transition-list'
  | 'expression-syntax'
  | 'expression-type'
  | 'unreachable-node'
  | 'cycle'
  | 'no-termination'
  | 'field-before-use'
  | 'language-coverage'
  | 'denied-language'
  | 'review-reference';

export interface ValidationIssue {
  code: IssueCode;
  /** Human-readable and actionable. This is the whole point of the validator. */
  message: string;
  /** JSON pointer into the document, e.g. `/nodes/3/prompt/hi`. */
  path: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Present only when `errors` is empty — an invalid document has no compiled form. */
  compiledGraph: CompiledGraph | null;
}

export interface ValidateOptions {
  /**
   * Publishing tightens the rules: incomplete translations stop being a warning and start
   * being an error (doc 06 §6). Drafts are meant to be half-finished; published versions
   * are what a patient meets.
   */
  forPublish?: boolean;
}

class IssueBag {
  readonly errors: ValidationIssue[] = [];
  readonly warnings: ValidationIssue[] = [];

  error(code: IssueCode, path: string, message: string): void {
    this.errors.push({ code, path, message });
  }

  warn(code: IssueCode, path: string, message: string): void {
    this.warnings.push({ code, path, message });
  }
}

/** JSON Pointer escaping (RFC 6901): `~` and `/` inside a key. */
function pointer(...segments: (string | number)[]): string {
  return segments
    .map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

// ---------------------------------------------------------------------------

export function validate(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const bag = new IssueBag();

  // --- 1. Shape -----------------------------------------------------------
  const parsed = workflowDocumentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      bag.error('shape', pointer(...issue.path), issue.message);
    }
    return { errors: bag.errors, warnings: bag.warnings, compiledGraph: null };
  }
  const doc = parsed.data;

  // --- 2. Identity & references -------------------------------------------
  const nodeIndexById = new Map<string, number>();
  for (const [index, node] of doc.nodes.entries()) {
    if (nodeIndexById.has(node.id)) {
      bag.error(
        'duplicate-node-id',
        pointer('nodes', index, 'id'),
        `duplicate node id \`${node.id}\` — ids identify nodes in the evidence stream and must be unique`,
      );
      continue;
    }
    nodeIndexById.set(node.id, index);
  }

  const fieldTypes: Record<string, ValueType> = {};
  for (const [key, field] of Object.entries(doc.fields)) {
    fieldTypes[key] = valueTypeByAnswerType[field.type];
  }

  const isKnownRef = (ref: string): boolean => ref === END_NODE_REF || nodeIndexById.has(ref);

  const usedFields = new Set<string>();

  for (const [index, node] of doc.nodes.entries()) {
    const at = (...rest: (string | number)[]): string => pointer('nodes', index, ...rest);

    if ('fieldKey' in node) {
      usedFields.add(node.fieldKey);
      const field = doc.fields[node.fieldKey];
      if (!field) {
        bag.error(
          'unknown-field',
          at('fieldKey'),
          `node \`${node.id}\` commits \`${node.fieldKey}\`, which is not declared in \`fields\``,
        );
      } else if (node.type === 'question' && node.answer && node.answer.type !== field.type) {
        bag.error(
          'answer-type-mismatch',
          at('answer', 'type'),
          `node \`${node.id}\` overrides the answer as \`${node.answer.type}\` but ` +
            `\`fields.${node.fieldKey}\` is \`${field.type}\` — the override may refine a field, not retype it`,
        );
      } else if (node.type === 'upload' && field.type !== 'media') {
        bag.error(
          'answer-type-mismatch',
          at('fieldKey'),
          `upload node \`${node.id}\` writes \`${node.fieldKey}\`, which is \`${field.type}\`; ` +
            'upload nodes need a `media` field',
        );
      }
    }

    // `next` targets
    if (node.type === 'branch') {
      for (const [caseIndex, branchCase] of node.cases.entries()) {
        if (!isKnownRef(branchCase.next)) {
          bag.error(
            'unknown-node-ref',
            at('cases', caseIndex, 'next'),
            `\`${branchCase.next}\` is not a node id in this document`,
          );
        }
      }
      if (!isKnownRef(node.else)) {
        bag.error(
          'unknown-node-ref',
          at('else'),
          `\`${node.else}\` is not a node id in this document`,
        );
      }
    } else if ('next' in node && node.next !== undefined) {
      if (typeof node.next === 'string') {
        if (!isKnownRef(node.next)) {
          bag.error(
            'unknown-node-ref',
            at('next'),
            `\`${node.next}\` is not a node id in this document`,
          );
        }
      } else {
        for (const [entryIndex, entry] of node.next.entries()) {
          if (!isKnownRef(entry.next)) {
            bag.error(
              'unknown-node-ref',
              at('next', entryIndex, 'next'),
              `\`${entry.next}\` is not a node id in this document`,
            );
          }
          const isLast = entryIndex === node.next.length - 1;
          if (isLast && entry.when !== undefined) {
            bag.error(
              'transition-list',
              at('next', entryIndex),
              `the last entry of a transition list must have no \`when\` — otherwise node ` +
                `\`${node.id}\` has a path with nowhere to go`,
            );
          }
          if (!isLast && entry.when === undefined) {
            bag.error(
              'transition-list',
              at('next', entryIndex),
              'only the last entry of a transition list may omit `when`; earlier entries after ' +
                'an unconditional one can never be reached',
            );
          }
        }
      }
    }

    if (node.type === 'action' && !isKnownRef(node.onFailure)) {
      bag.error(
        'unknown-node-ref',
        at('onFailure'),
        `\`${node.onFailure}\` is not a node id in this document`,
      );
    }
  }

  for (const key of Object.keys(doc.fields)) {
    if (!usedFields.has(key)) {
      bag.warn(
        'unused-field',
        pointer('fields', key),
        `field \`${key}\` is declared but no node commits it — it will never have a value`,
      );
    }
  }

  for (const [index, key] of doc.review.alwaysReview.entries()) {
    if (!doc.fields[key]) {
      bag.error(
        'review-reference',
        pointer('review', 'alwaysReview', index),
        `\`review.alwaysReview\` names \`${key}\`, which is not a declared field`,
      );
    }
  }

  // --- 3. Expressions: parse ---------------------------------------------
  interface ParsedExpression {
    path: string;
    source: string;
    ast: ExpressionNode;
  }
  const parseAt = (source: string, path: string): ParsedExpression | null => {
    try {
      return { path, source, ast: parseExpression(source) };
    } catch (error) {
      const message =
        error instanceof ExpressionSyntaxError
          ? error.message
          : `could not parse: ${String(error)}`;
      bag.error('expression-syntax', path, message);
      return null;
    }
  };

  /** Conditions bound to a node, keyed by node id, in evaluation order. */
  const nodeConditions = new Map<string, ParsedExpression[]>();
  const computedExpressions = new Map<string, ParsedExpression>();

  for (const [index, node] of doc.nodes.entries()) {
    const at = (...rest: (string | number)[]): string => pointer('nodes', index, ...rest);
    const conditions: ParsedExpression[] = [];

    if (node.type === 'branch') {
      for (const [caseIndex, branchCase] of node.cases.entries()) {
        const parsedCase = parseAt(branchCase.when, at('cases', caseIndex, 'when'));
        if (parsedCase) conditions.push(parsedCase);
      }
    } else if (node.type === 'computed') {
      const expr = parseAt(node.expr, at('expr'));
      if (expr) computedExpressions.set(node.id, expr);
    }

    if ('next' in node && Array.isArray(node.next)) {
      for (const [entryIndex, entry] of node.next.entries()) {
        if (entry.when === undefined) continue;
        const parsedEntry = parseAt(entry.when, at('next', entryIndex, 'when'));
        if (parsedEntry) conditions.push(parsedEntry);
      }
    }

    if (conditions.length > 0) nodeConditions.set(node.id, conditions);
  }

  const redFlagExpressions = doc.rules.redFlags.map((flag, index) =>
    parseAt(flag.when, pointer('rules', 'redFlags', index, 'when')),
  );
  const validationExpressions = doc.rules.validations.map((rule, index) => ({
    when: parseAt(rule.when, pointer('rules', 'validations', index, 'when')),
    assert: parseAt(rule.assert, pointer('rules', 'validations', index, 'assert')),
  }));

  // --- 4. Graph topology --------------------------------------------------
  const startNode = doc.nodes[0]!;
  const successors = new Map<string, string[]>();
  for (const node of doc.nodes) {
    successors.set(
      node.id,
      outgoingRefs(node).filter((ref) => ref !== END_NODE_REF && nodeIndexById.has(ref)),
    );
  }

  const reachable = new Set<string>();
  const stack = [startNode.id];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of successors.get(id) ?? []) stack.push(next);
  }

  for (const [index, node] of doc.nodes.entries()) {
    if (!reachable.has(node.id)) {
      bag.error(
        'unreachable-node',
        pointer('nodes', index),
        `node \`${node.id}\` cannot be reached from the start node \`${startNode.id}\` — ` +
          'either route to it or delete it',
      );
    }
  }

  const cycle = findCycle(startNode.id, successors);
  if (cycle) {
    const index = nodeIndexById.get(cycle[0]!) ?? 0;
    bag.error(
      'cycle',
      pointer('nodes', index),
      `the graph loops: ${cycle.join(' → ')}. Intake flows must terminate; repeat a question ` +
        'through a clarification attempt, not by routing backwards',
    );
  }

  // Termination: every reachable node must have a path to a terminal one.
  const isTerminal = (node: DslNode): boolean =>
    node.type === 'end' ||
    outgoingRefs(node).includes(END_NODE_REF) ||
    (node.type === 'handoff' && node.next === undefined);

  const terminates = new Set<string>();
  for (const node of doc.nodes) if (isTerminal(node)) terminates.add(node.id);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of doc.nodes) {
      if (terminates.has(node.id)) continue;
      if ((successors.get(node.id) ?? []).some((next) => terminates.has(next))) {
        terminates.add(node.id);
        changed = true;
      }
    }
  }
  // A cycle already explains "no path to an end"; reporting both is noise.
  if (!cycle) {
    for (const [index, node] of doc.nodes.entries()) {
      if (reachable.has(node.id) && !terminates.has(node.id)) {
        bag.error(
          'no-termination',
          pointer('nodes', index),
          `no path from node \`${node.id}\` reaches an \`end\` node — every intake must finish`,
        );
      }
    }
  }

  // --- 5. Dataflow: what is committed where -------------------------------
  const committedBefore = computeCommittedBefore(
    doc,
    successors,
    reachable,
    startNode.id,
    cycle !== null,
  );

  const allFields = new Set(Object.keys(doc.fields));

  for (const node of doc.nodes) {
    if (!reachable.has(node.id)) continue;
    const before = committedBefore.get(node.id) ?? new Set<string>();

    // A computed node reads only what precedes it; the field it writes is not yet committed.
    const computed = computedExpressions.get(node.id);
    if (computed) {
      for (const issue of typeCheckExpression(computed.ast, {
        fieldTypes,
        available: before,
      })) {
        bag.error(
          issue.message.includes('is read before') ? 'field-before-use' : 'expression-type',
          computed.path,
          issue.message,
        );
      }
    }

    // Conditions on the way *out* of a node run after that node committed its own field.
    const after = new Set(before);
    if ('fieldKey' in node) after.add(node.fieldKey);

    for (const condition of nodeConditions.get(node.id) ?? []) {
      for (const issue of typeCheckCondition(condition.ast, { fieldTypes, available: after })) {
        bag.error(
          issue.message.includes('is read before') ? 'field-before-use' : 'expression-type',
          condition.path,
          issue.message,
        );
      }
    }
  }

  /**
   * Rules are evaluated after *every* commit, not at one point in the graph, so a
   * field-before-use check does not apply: an uncommitted field reads as `undefined`, which
   * the evaluator treats as falsy. Types still have to line up.
   */
  for (const [index, expr] of redFlagExpressions.entries()) {
    if (!expr) continue;
    for (const issue of typeCheckCondition(expr.ast, { fieldTypes, available: allFields })) {
      bag.error('expression-type', pointer('rules', 'redFlags', index, 'when'), issue.message);
    }
  }
  for (const [index, pair] of validationExpressions.entries()) {
    for (const [name, expr] of [
      ['when', pair.when],
      ['assert', pair.assert],
    ] as const) {
      if (!expr) continue;
      for (const issue of typeCheckCondition(expr.ast, { fieldTypes, available: allFields })) {
        bag.error('expression-type', pointer('rules', 'validations', index, name), issue.message);
      }
    }
  }

  // --- 6. Language coverage & deny-list -----------------------------------
  for (const entry of patientFacingStrings(doc)) {
    for (const language of doc.languages) {
      if (typeof entry.text[language] === 'string') continue;
      const message =
        `no \`${language}\` text — it will fall back to \`${doc.languages[0]}\`, ` +
        'which a patient reading in ' +
        `\`${language}\` cannot use`;
      if (options.forPublish) {
        bag.error('language-coverage', pointer(...entry.path, language), message);
      } else {
        bag.warn('language-coverage', pointer(...entry.path, language), message);
      }
    }

    for (const [language, text] of Object.entries(entry.text)) {
      for (const hit of scanForDeniedLanguage(text, entry.scope)) {
        bag.error(
          'denied-language',
          pointer(...entry.path, language),
          `"${hit.match}" is not allowed in patient-facing text (rule \`${hit.ruleId}\`). ${hit.guidance}`,
        );
      }
    }
  }

  // --- 7. Compile ---------------------------------------------------------
  if (bag.errors.length > 0) {
    return { errors: bag.errors, warnings: bag.warnings, compiledGraph: null };
  }

  const compiledGraph = compile(doc, {
    committedBefore,
    computedExpressions,
    redFlagExpressions,
    validationExpressions,
  });

  return { errors: bag.errors, warnings: bag.warnings, compiledGraph };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every node reference a node can hand control to, in evaluation order. */
function outgoingRefs(node: DslNode): string[] {
  const refs: string[] = [];
  if (node.type === 'branch') {
    for (const branchCase of node.cases) refs.push(branchCase.next);
    refs.push(node.else);
    return refs;
  }
  if ('next' in node && node.next !== undefined) {
    if (typeof node.next === 'string') refs.push(node.next);
    else for (const entry of node.next) refs.push(entry.next);
  }
  if (node.type === 'action') refs.push(node.onFailure);
  return refs;
}

/** Returns one cycle as a node-id path, or `null`. Depth-first, colour-marked. */
function findCycle(startId: string, successors: Map<string, string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];

  const walk = (id: string): string[] | null => {
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'visiting') return [...path.slice(path.indexOf(id)), id];

    state.set(id, 'visiting');
    path.push(id);
    for (const next of successors.get(id) ?? []) {
      const found = walk(next);
      if (found) return found;
    }
    path.pop();
    state.set(id, 'done');
    return null;
  };

  return walk(startId);
}

/**
 * Forward dataflow: the set of fields committed on **every** path reaching each node.
 *
 * Intersection, not union, is the whole point — a field committed on one branch only is
 * exactly the case that produces an expression reading `undefined` in production. The graph
 * is acyclic (checked above), so a worklist pass converges; when a cycle was found the
 * analysis is skipped rather than run on a graph that has no topological order.
 */
function computeCommittedBefore(
  doc: WorkflowDocument,
  successors: Map<string, string[]>,
  reachable: Set<string>,
  startId: string,
  hasCycle: boolean,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  if (hasCycle) return result;

  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]));
  const predecessors = new Map<string, string[]>();
  for (const [id, nexts] of successors) {
    for (const next of nexts) {
      predecessors.set(next, [...(predecessors.get(next) ?? []), id]);
    }
  }

  // Topological order over the reachable subgraph.
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const next of successors.get(id) ?? []) visit(next);
    order.unshift(id);
  };
  visit(startId);

  for (const id of order) {
    const preds = (predecessors.get(id) ?? []).filter((pred) => reachable.has(pred));
    let incoming: Set<string>;
    if (id === startId || preds.length === 0) {
      incoming = new Set<string>();
    } else {
      const sets = preds.map((pred) => {
        const before = result.get(pred) ?? new Set<string>();
        const node = nodeById.get(pred);
        const out = new Set(before);
        if (node && 'fieldKey' in node) out.add(node.fieldKey);
        return out;
      });
      incoming = sets.reduce((acc, set) => new Set([...acc].filter((key) => set.has(key))));
    }
    result.set(id, incoming);
  }

  return result;
}

interface LocalizedEntry {
  path: (string | number)[];
  text: LocalizedText;
  /** Which deny-list rules apply — see `DenyScope`. */
  scope: DenyScope;
}

/**
 * Every string a patient can see. Staff-only strings (`staffNote`, `reason`, `label`) are
 * deliberately absent: clinical vocabulary between clinicians is not a safety problem, and
 * scanning it would make the deny-list unusable.
 */
function patientFacingStrings(doc: WorkflowDocument): LocalizedEntry[] {
  const entries: LocalizedEntry[] = [
    { path: ['title'], text: doc.title, scope: 'statement' },
    { path: ['consent', 'text'], text: doc.consent.text, scope: 'statement' },
  ];

  for (const [key, field] of Object.entries(doc.fields)) {
    if (field.type === 'choice' || field.type === 'multiChoice') {
      for (const [index, option] of field.options.entries()) {
        entries.push({
          path: ['fields', key, 'options', index, 'label'],
          text: option.label,
          scope: 'question',
        });
      }
    }
  }

  for (const [index, node] of doc.nodes.entries()) {
    // A `question` prompt asks; an `info` or `end` prompt tells. Same field name, different
    // safety rules — see `DenyScope`.
    const scope: DenyScope =
      node.type === 'question' || node.type === 'upload' ? 'question' : 'statement';
    if ('prompt' in node && node.prompt) {
      entries.push({ path: ['nodes', index, 'prompt'], text: node.prompt, scope });
    }
    if ('helpText' in node && node.helpText) {
      entries.push({ path: ['nodes', index, 'helpText'], text: node.helpText, scope });
    }
    if (node.type === 'question' && node.answer) {
      const answer: AnswerSchema = node.answer;
      if (answer.type === 'choice' || answer.type === 'multiChoice') {
        for (const [optionIndex, option] of answer.options.entries()) {
          entries.push({
            path: ['nodes', index, 'answer', 'options', optionIndex, 'label'],
            text: option.label,
            scope: 'question',
          });
        }
      }
    }
  }

  for (const [index, flag] of doc.rules.redFlags.entries()) {
    if (flag.patientMessage) {
      entries.push({
        path: ['rules', 'redFlags', index, 'patientMessage'],
        text: flag.patientMessage,
        scope: 'statement',
      });
    }
  }
  for (const [index, rule] of doc.rules.validations.entries()) {
    entries.push({
      path: ['rules', 'validations', index, 'message'],
      text: rule.message,
      scope: 'statement',
    });
  }

  return entries;
}

interface CompileInputs {
  committedBefore: Map<string, Set<string>>;
  computedExpressions: Map<string, { source: string; ast: ExpressionNode }>;
  redFlagExpressions: ({ source: string; ast: ExpressionNode } | null)[];
  validationExpressions: {
    when: { source: string; ast: ExpressionNode } | null;
    assert: { source: string; ast: ExpressionNode } | null;
  }[];
}

function compiledExpression(source: string, ast: ExpressionNode): CompiledExpression {
  return { source, ast, reads: referencedFields(ast) };
}

/** Builds the compiled graph. Only ever called on a document with zero errors. */
function compile(doc: WorkflowDocument, inputs: CompileInputs): CompiledGraph {
  const nodes: Record<string, CompiledNode> = {};
  const terminalNodeIds: string[] = [];
  let questionCount = 0;

  for (const node of doc.nodes) {
    const mode = node.mode ?? doc.defaultMode;
    const skippable =
      typeof node.skippable === 'boolean' ? node.skippable : node.skippable !== undefined;
    const skipReason =
      typeof node.skippable === 'object' && node.skippable !== null
        ? node.skippable.reason
        : undefined;

    const transitions: CompiledTransition[] = [];
    if (node.type === 'branch') {
      for (const branchCase of node.cases) {
        transitions.push({
          when: compiledExpression(branchCase.when, parseExpression(branchCase.when)),
          next: branchCase.next,
        });
      }
      transitions.push({ when: null, next: node.else });
    } else if ('next' in node && node.next !== undefined) {
      if (typeof node.next === 'string') {
        transitions.push({ when: null, next: node.next });
      } else {
        for (const entry of node.next) {
          transitions.push({
            when:
              entry.when === undefined
                ? null
                : compiledExpression(entry.when, parseExpression(entry.when)),
            next: entry.next,
          });
        }
      }
    }

    const compiled: CompiledNode = {
      id: node.id,
      type: node.type,
      transitions,
      edges: [...new Set(transitions.map((t) => t.next).filter((next) => next !== END_NODE_REF))],
      terminal: node.type === 'end' || transitions.length === 0,
      mode,
      modes: modesFor(mode),
      skippable,
      ...(skipReason ? { skipReason } : {}),
      committedBefore: [...(inputs.committedBefore.get(node.id) ?? [])],
    };

    if ('fieldKey' in node) {
      const field = doc.fields[node.fieldKey]!;
      compiled.fieldKey = node.fieldKey;
      compiled.required = field.required;
      // The node's override wins where it exists; `answer` is what the runner renders and
      // what the S04 answer validator checks against, so it has to be fully resolved here.
      const { required: _required, retention: _retention, ...answerFromField } = field;
      compiled.answer =
        node.type === 'question' && node.answer ? node.answer : (answerFromField as AnswerSchema);
    }

    if (node.type === 'question') {
      questionCount += 1;
      compiled.confirm = node.confirm;
      compiled.prompt = node.prompt;
      if (node.helpText) compiled.helpText = node.helpText;
      if (node.promptAudio) compiled.promptAudio = node.promptAudio;
    }
    if (node.type === 'info') {
      compiled.prompt = node.prompt;
      if (node.promptAudio) compiled.promptAudio = node.promptAudio;
    }
    if (node.type === 'upload') {
      questionCount += 1;
      compiled.prompt = node.prompt;
      compiled.accept = node.accept;
      compiled.maxFiles = node.maxFiles;
    }
    if (node.type === 'computed') {
      const expr = inputs.computedExpressions.get(node.id)!;
      compiled.expr = compiledExpression(expr.source, expr.ast);
    }
    if (node.type === 'handoff') {
      compiled.reason = node.reason;
      compiled.resumable = node.resumable;
      if (node.prompt) compiled.prompt = node.prompt;
    }
    if (node.type === 'checkpoint' && node.label) compiled.label = node.label;
    if (node.type === 'end') {
      compiled.outcome = node.outcome;
      if (node.prompt) compiled.prompt = node.prompt;
    }
    if (node.type === 'action') {
      compiled.actionKind = node.actionKind;
      compiled.onFailure = node.onFailure;
      compiled.actionParams = Object.fromEntries(
        Object.entries(node.params).map(([key, value]) => [
          key,
          typeof value === 'string' && value.startsWith('f.')
            ? compiledExpression(value, parseExpression(value))
            : value,
        ]),
      );
    }

    if (compiled.terminal) terminalNodeIds.push(node.id);
    nodes[node.id] = compiled;
  }

  return {
    dslVersion: doc.dslVersion,
    compilerVersion: DSL_GRAMMAR_VERSION,
    key: doc.key,
    title: doc.title,
    languages: doc.languages,
    fallbackLanguage: doc.languages[0]!,
    defaultMode: doc.defaultMode,
    settings: doc.settings,
    consent: doc.consent,
    startNodeId: doc.nodes[0]!.id,
    order: doc.nodes.map((node) => node.id),
    nodes,
    terminalNodeIds,
    fields: Object.fromEntries(
      Object.entries(doc.fields).map(([key, field]) => [
        key,
        {
          type: field.type,
          valueType: valueTypeByAnswerType[field.type],
          required: field.required,
          ...(field.retention ? { retention: field.retention } : {}),
        },
      ]),
    ),
    redFlags: doc.rules.redFlags.map((flag, index) => {
      const expr = inputs.redFlagExpressions[index]!;
      return {
        id: flag.id,
        when: compiledExpression(expr.source, expr.ast),
        severity: flag.severity,
        escalation: flag.escalation,
        ...(flag.patientMessage ? { patientMessage: flag.patientMessage } : {}),
        ...(flag.staffNote ? { staffNote: flag.staffNote } : {}),
      };
    }),
    validations: doc.rules.validations.map((rule, index) => {
      const pair = inputs.validationExpressions[index]!;
      return {
        id: rule.id,
        when: compiledExpression(pair.when!.source, pair.when!.ast),
        assert: compiledExpression(pair.assert!.source, pair.assert!.ast),
        message: rule.message,
        severity: rule.severity,
      };
    }),
    review: doc.review,
    output: doc.output,
    questionCount,
  };
}
