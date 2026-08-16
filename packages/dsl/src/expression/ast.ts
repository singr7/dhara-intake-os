/**
 * The expression AST (doc 06 §4).
 *
 * Every node is a plain JSON object with no methods and no class identity, because the
 * compiled graph — ASTs included — is frozen into a `workflow_versions` JSONB column and
 * read back by a different process. Anything that would not survive `JSON.parse` does not
 * belong in this file.
 */

export type ComparisonOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

/** The four functions in the grammar. The set is closed: DSL authors cannot add one. */
export const expressionFunctions = ['exists', 'contains', 'count', 'ageYears'] as const;
export type ExpressionFunction = (typeof expressionFunctions)[number];

export type LiteralValue = string | number | boolean | null;

export type ExpressionNode =
  | { kind: 'literal'; value: LiteralValue }
  | { kind: 'field'; fieldKey: string }
  | { kind: 'not'; operand: ExpressionNode }
  | { kind: 'and'; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'or'; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'compare'; op: ComparisonOperator; left: ExpressionNode; right: ExpressionNode }
  | { kind: 'call'; fn: ExpressionFunction; args: ExpressionNode[] };

/** Every fieldKey the expression reads, in first-seen order. */
export function referencedFields(node: ExpressionNode): string[] {
  const seen: string[] = [];
  const walk = (current: ExpressionNode): void => {
    switch (current.kind) {
      case 'field':
        if (!seen.includes(current.fieldKey)) seen.push(current.fieldKey);
        return;
      case 'not':
        walk(current.operand);
        return;
      case 'and':
      case 'or':
      case 'compare':
        walk(current.left);
        walk(current.right);
        return;
      case 'call':
        for (const arg of current.args) walk(arg);
        return;
      case 'literal':
        return;
    }
  };
  walk(node);
  return seen;
}
