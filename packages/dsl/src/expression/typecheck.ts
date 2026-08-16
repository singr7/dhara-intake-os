import type { AnswerType } from '@dhara/contracts';
import type { ExpressionNode } from './ast.js';

/**
 * Static type-checking of expressions against the document's field types (doc 06 §7).
 *
 * This is the check that turns "the branch never fires and nobody noticed for a month" into
 * a publish-time error. `f.chest_pain == "yes"` against a boolean field, `count(f.age)`,
 * `f.symptoms == "fever"` on a multiChoice — all caught here rather than at 9am in a clinic.
 */

/** The value shape a field commits, which is what expressions actually operate on. */
export type ValueType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'stringList'
  | 'duration'
  | 'date'
  | 'media'
  /** A reference the checker could not resolve; suppresses cascading errors. */
  | 'unknown';

export const valueTypeByAnswerType: Record<AnswerType, ValueType> = {
  choice: 'string',
  multiChoice: 'stringList',
  boolean: 'boolean',
  number: 'number',
  duration: 'duration',
  date: 'date',
  text: 'string',
  phone: 'string',
  id: 'string',
  bodyLocation: 'stringList',
  media: 'media',
};

export interface TypeIssue {
  message: string;
}

const readable: Record<ValueType, string> = {
  boolean: 'a yes/no field',
  number: 'a number field',
  string: 'a text field',
  stringList: 'a multi-choice field',
  duration: 'a duration field',
  date: 'a date field',
  media: 'an uploaded file field',
  unknown: 'an unknown field',
};

type Checked = { type: ValueType | 'null' };

export interface TypeCheckOptions {
  fieldTypes: Readonly<Record<string, ValueType>>;
  /**
   * Fields the expression is allowed to name. Defaults to every declared field; the
   * field-before-use check passes a narrower set for expressions bound to a node.
   */
  available?: ReadonlySet<string>;
}

export interface InferResult {
  issues: TypeIssue[];
  type: ValueType | 'null';
}

/**
 * Infers an expression's type and collects every problem found (not just the first — an
 * author fixing a rule wants the whole list).
 */
export function inferExpression(node: ExpressionNode, opts: TypeCheckOptions): InferResult {
  const issues: TypeIssue[] = [];

  const fail = (message: string): void => {
    issues.push({ message });
  };

  const requireBoolean = (child: ExpressionNode, where: string): void => {
    const type = check(child).type;
    if (type !== 'boolean' && type !== 'unknown') {
      fail(
        `\`${where}\` needs yes/no operands, got ${readable[type === 'null' ? 'unknown' : type]}`,
      );
    }
  };

  const check = (current: ExpressionNode): Checked => {
    switch (current.kind) {
      case 'literal':
        if (current.value === null) return { type: 'null' };
        if (typeof current.value === 'boolean') return { type: 'boolean' };
        if (typeof current.value === 'number') return { type: 'number' };
        return { type: 'string' };

      case 'field': {
        const type = opts.fieldTypes[current.fieldKey];
        if (!type) {
          fail(`unknown field \`f.${current.fieldKey}\` — it is not declared in \`fields\``);
          return { type: 'unknown' };
        }
        if (opts.available && !opts.available.has(current.fieldKey)) {
          fail(
            `\`f.${current.fieldKey}\` is read before it can be committed on every path ` +
              'reaching this point',
          );
        }
        return { type };
      }

      case 'not':
        requireBoolean(current.operand, '!');
        return { type: 'boolean' };

      case 'and':
      case 'or':
        requireBoolean(current.left, current.kind === 'and' ? '&&' : '||');
        requireBoolean(current.right, current.kind === 'and' ? '&&' : '||');
        return { type: 'boolean' };

      case 'compare': {
        const left = check(current.left).type;
        const right = check(current.right).type;
        const known = left !== 'unknown' && right !== 'unknown';

        if (current.op === '==' || current.op === '!=') {
          if (known && (left === 'stringList' || right === 'stringList')) {
            fail(
              `\`${current.op}\` cannot compare a multi-choice field — ` +
                'use contains(f.x, "value") or count(f.x)',
            );
          } else if (known && left !== 'null' && right !== 'null' && left !== right) {
            fail(
              `\`${current.op}\` compares ${readable[left]} with ${readable[right]}; ` +
                'the two sides must have the same type',
            );
          }
          return { type: 'boolean' };
        }

        const ordered = (type: ValueType | 'null'): boolean =>
          type === 'number' || type === 'date' || type === 'unknown';
        if (known && (!ordered(left) || !ordered(right) || left !== right)) {
          fail(
            `\`${current.op}\` needs two numbers or two dates, got ` +
              `${readable[left === 'null' ? 'unknown' : left]} and ` +
              `${readable[right === 'null' ? 'unknown' : right]}`,
          );
        }
        return { type: 'boolean' };
      }

      case 'call': {
        const arity: Record<typeof current.fn, number> = {
          exists: 1,
          contains: 2,
          count: 1,
          ageYears: 1,
        };
        const expected = arity[current.fn];
        if (current.args.length !== expected) {
          fail(
            `${current.fn}() takes ${expected} argument${expected === 1 ? '' : 's'}, ` +
              `got ${current.args.length}`,
          );
          for (const arg of current.args) check(arg);
          return {
            type: current.fn === 'count' || current.fn === 'ageYears' ? 'number' : 'boolean',
          };
        }

        const first = check(current.args[0]!).type;
        switch (current.fn) {
          case 'exists':
            if (current.args[0]!.kind !== 'field') {
              fail('exists() takes a field reference, such as exists(f.chief_complaint)');
            }
            return { type: 'boolean' };

          case 'contains': {
            if (first !== 'stringList' && first !== 'string' && first !== 'unknown') {
              fail(
                `contains() needs a multi-choice or text field, got ${readable[first === 'null' ? 'unknown' : first]}`,
              );
            }
            const second = check(current.args[1]!).type;
            if (second !== 'string' && second !== 'unknown') {
              fail('contains() takes a quoted value as its second argument');
            }
            return { type: 'boolean' };
          }

          case 'count':
            if (first !== 'stringList' && first !== 'unknown') {
              fail(
                `count() needs a multi-choice field, got ${readable[first === 'null' ? 'unknown' : first]}`,
              );
            }
            return { type: 'number' };

          case 'ageYears':
            if (first !== 'date' && first !== 'unknown') {
              fail(
                `ageYears() needs a date field, got ${readable[first === 'null' ? 'unknown' : first]}`,
              );
            }
            return { type: 'number' };
        }
      }
    }
  };

  return { issues, type: check(node).type };
}

/** Type-checks an AST, ignoring the type it produces. */
export function typeCheckExpression(node: ExpressionNode, opts: TypeCheckOptions): TypeIssue[] {
  return inferExpression(node, opts).issues;
}

/** Type-checks an expression used as a condition: it must evaluate to a yes/no. */
export function typeCheckCondition(node: ExpressionNode, opts: TypeCheckOptions): TypeIssue[] {
  const { issues, type } = inferExpression(node, opts);
  if (type !== 'boolean' && type !== 'unknown') {
    issues.push({
      message: `a condition must evaluate to yes/no, but this one evaluates to ${
        readable[type === 'null' ? 'unknown' : type]
      }`,
    });
  }
  return issues;
}
