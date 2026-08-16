/**
 * @dhara/dsl — the workflow compiler and interpreter (doc 06).
 *
 * Three things live here and nowhere else: the expression grammar (parsed, never `eval`ed —
 * ADR-007), `validate()` with the graph, dataflow, language and safety checks that Zod
 * cannot express, and the pure interpreter the session engine drives.
 *
 * The package has no I/O, no database access and no Fastify. That is what lets the eval
 * harness (S18) replay a workflow offline and the studio (M5) validate a draft in a
 * browser worker.
 */

export const DSL_PACKAGE = '@dhara/dsl' as const;

export { DSL_GRAMMAR_VERSION } from './version.js';

// Expression grammar
export {
  expressionFunctions,
  referencedFields,
  type ComparisonOperator,
  type ExpressionFunction,
  type ExpressionNode,
  type LiteralValue,
} from './expression/ast.js';
export { ExpressionSyntaxError, parseExpression } from './expression/parse.js';
export {
  ExpressionRuntimeError,
  evaluateCondition,
  evaluateExpression,
  type DurationValue,
  type EvaluationContext,
  type FieldValue,
} from './expression/evaluate.js';
export {
  inferExpression,
  typeCheckCondition,
  typeCheckExpression,
  valueTypeByAnswerType,
  type TypeCheckOptions,
  type TypeIssue,
  type ValueType,
} from './expression/typecheck.js';

// Safety
export {
  denyListRules,
  scanForDeniedLanguage,
  type DenyListHit,
  type DenyListRule,
  type DenyScope,
} from './denylist.js';

// Compiler
export {
  validate,
  type IssueCode,
  type ValidateOptions,
  type ValidationIssue,
  type ValidationResult,
} from './validate.js';
export {
  modesFor,
  type CompiledExpression,
  type CompiledField,
  type CompiledGraph,
  type CompiledNode,
  type CompiledRedFlag,
  type CompiledTransition,
  type CompiledValidation,
  type InteractionMode,
} from './compiled.js';

// Interpreter
export {
  evaluateComputed,
  evaluateRedFlags,
  evaluateValidations,
  getNode,
  localize,
  nextNode,
  startNode,
  type CommittedFields,
  type NextNodeResult,
  type RaisedRedFlag,
  type TraversalOptions,
  type ValidationBreach,
} from './interpreter.js';

// Versioning
export {
  INITIAL_SEMVER,
  bumpSemver,
  classifyChange,
  formatSemver,
  parseSemver,
  type BumpKind,
  type SemverParts,
} from './semver.js';
