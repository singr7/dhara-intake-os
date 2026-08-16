import type { ExpressionNode, LiteralValue } from './ast.js';

/**
 * The expression evaluator: a plain recursive walk over the AST, with no host access of
 * any kind. The only inputs are committed field values.
 */

export class ExpressionRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionRuntimeError';
  }
}

/** A normalized duration value as committed by a `duration` field (doc 06 §3). */
export interface DurationValue {
  value: number;
  unit: 'days' | 'weeks' | 'months' | 'years';
}

export type FieldValue = string | number | boolean | string[] | DurationValue | null | undefined;

export interface EvaluationContext {
  /** Committed field values, keyed by fieldKey — the `f` namespace in the grammar. */
  f: Readonly<Record<string, FieldValue>>;
  /** Injected so `ageYears()` is deterministic in tests and in replayed evidence. */
  now?: Date;
}

function isDuration(value: unknown): value is DurationValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    'unit' in value &&
    typeof (value as DurationValue).value === 'number'
  );
}

/**
 * An uncommitted field reads as `undefined`, and `undefined` is falsy rather than fatal.
 * The validator's field-before-use check is what guarantees a branch never *depends* on an
 * uncommitted field; this rule covers the remaining case — an optional field that was
 * legitimately skipped — where routing to the `else` arm is the right behaviour and
 * throwing mid-intake is not.
 */
function toBoolean(value: unknown, where: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  throw new ExpressionRuntimeError(`${where} expects a boolean, got ${describe(value)}`);
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  if (isDuration(value)) return 'a duration';
  if (value === null) return 'null';
  return typeof value;
}

function compareOrdered(op: string, left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    switch (op) {
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '<':
        return left < right;
      default:
        return left <= right;
    }
  }
  // ISO-8601 dates order correctly as strings, which is why `date` values are stored as
  // ISO strings rather than parsed here.
  if (typeof left === 'string' && typeof right === 'string') {
    switch (op) {
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      case '<':
        return left < right;
      default:
        return left <= right;
    }
  }
  if (left === undefined || right === undefined || left === null || right === null) return false;
  throw new ExpressionRuntimeError(
    `\`${op}\` needs two numbers or two dates, got ${describe(left)} and ${describe(right)}`,
  );
}

function equals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  // `null` and "never answered" are the same thing to an author writing `f.x == null`.
  if ((left ?? null) === null && (right ?? null) === null) return true;
  if (isDuration(left) && isDuration(right)) {
    return left.value === right.value && left.unit === right.unit;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    throw new ExpressionRuntimeError(
      'lists cannot be compared with `==` — use contains() or count()',
    );
  }
  return false;
}

function argValue(node: ExpressionNode, ctx: EvaluationContext): FieldValue {
  return evaluateExpression(node, ctx) as FieldValue;
}

function wholeYearsBetween(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) {
    throw new ExpressionRuntimeError(`ageYears() needs a date, got \`${iso}\``);
  }
  let years = now.getUTCFullYear() - then.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - then.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < then.getUTCDate())) years -= 1;
  return years;
}

/** Evaluates an AST against committed field values. Throws on a genuine type misuse. */
export function evaluateExpression(node: ExpressionNode, ctx: EvaluationContext): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value satisfies LiteralValue;

    case 'field':
      // Own-property only: belt to the parser's braces, since a compiled graph read back
      // from JSONB has not necessarily been through this build's parser.
      return Object.prototype.hasOwnProperty.call(ctx.f, node.fieldKey)
        ? ctx.f[node.fieldKey]
        : undefined;

    case 'not':
      return !toBoolean(evaluateExpression(node.operand, ctx), '`!`');

    case 'and':
      // Short-circuits, so `exists(f.x) && f.x > 5` is safe to write.
      return (
        toBoolean(evaluateExpression(node.left, ctx), '`&&`') &&
        toBoolean(evaluateExpression(node.right, ctx), '`&&`')
      );

    case 'or':
      return (
        toBoolean(evaluateExpression(node.left, ctx), '`||`') ||
        toBoolean(evaluateExpression(node.right, ctx), '`||`')
      );

    case 'compare': {
      const left = evaluateExpression(node.left, ctx);
      const right = evaluateExpression(node.right, ctx);
      switch (node.op) {
        case '==':
          return equals(left, right);
        case '!=':
          return !equals(left, right);
        default:
          return compareOrdered(node.op, left, right);
      }
    }

    case 'call': {
      switch (node.fn) {
        case 'exists': {
          const value = argValue(node.args[0]!, ctx);
          if (value === undefined || value === null) return false;
          if (typeof value === 'string') return value.length > 0;
          if (Array.isArray(value)) return value.length > 0;
          return true;
        }
        case 'contains': {
          const haystack = argValue(node.args[0]!, ctx);
          const needle = argValue(node.args[1]!, ctx);
          if (haystack === undefined || haystack === null) return false;
          if (Array.isArray(haystack)) return haystack.includes(String(needle));
          if (typeof haystack === 'string') return haystack.includes(String(needle));
          throw new ExpressionRuntimeError(
            `contains() needs a list or text, got ${describe(haystack)}`,
          );
        }
        case 'count': {
          const value = argValue(node.args[0]!, ctx);
          if (value === undefined || value === null) return 0;
          if (Array.isArray(value)) return value.length;
          throw new ExpressionRuntimeError(`count() needs a list, got ${describe(value)}`);
        }
        case 'ageYears': {
          const value = argValue(node.args[0]!, ctx);
          if (value === undefined || value === null) return 0;
          if (typeof value !== 'string') {
            throw new ExpressionRuntimeError(`ageYears() needs a date, got ${describe(value)}`);
          }
          return wholeYearsBetween(value, ctx.now ?? new Date());
        }
      }
    }
  }
}

/** Evaluates an expression and coerces the result to a boolean, for `when` conditions. */
export function evaluateCondition(node: ExpressionNode, ctx: EvaluationContext): boolean {
  return toBoolean(evaluateExpression(node, ctx), 'condition');
}
