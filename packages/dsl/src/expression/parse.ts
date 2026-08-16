import {
  expressionFunctions,
  type ComparisonOperator,
  type ExpressionFunction,
  type ExpressionNode,
} from './ast.js';

/**
 * Lexer + recursive-descent parser for the doc 06 §4 grammar.
 *
 *   expr    := or
 *   or      := and ("||" and)*
 *   and     := cmp ("&&" cmp)*
 *   cmp     := "!" cmp | operand (("=="|"!="|">"|">="|"<"|"<=") operand)?
 *   operand := "(" expr ")" | f.<fieldKey> | literal | fn "(" args ")"
 *
 * There is no `eval`, no `new Function`, no template compilation (ADR-007). The grammar is
 * not Turing-complete and has no way to reach a host object: the only things an expression
 * can name are field keys and the four functions below.
 */

export class ExpressionSyntaxError extends Error {
  /** Zero-based offset into the source string where the parse gave up. */
  readonly position: number;

  constructor(message: string, position: number, source: string) {
    super(`${message} at position ${position} in \`${source}\``);
    this.name = 'ExpressionSyntaxError';
    this.position = position;
  }
}

type TokenType =
  | 'field'
  | 'ident'
  | 'number'
  | 'string'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

interface Token {
  type: TokenType;
  text: string;
  value?: string | number | boolean | null;
  position: number;
}

const OPERATORS = ['&&', '||', '==', '!=', '>=', '<=', '>', '<', '!'] as const;
const COMPARISONS: readonly string[] = ['==', '!=', '>', '>=', '<', '<='];

const IDENT_START = /[A-Za-z_]/;
const FIELD_KEY = /^[a-z][a-z0-9_]*$/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i]!;

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen', text: '(', position: i });
      i += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', text: ')', position: i });
      i += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma', text: ',', position: i });
      i += 1;
      continue;
    }

    // String literal. Both quote styles are accepted so JSON-embedded expressions can use
    // single quotes without escaping; there are no escape sequences and no interpolation.
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, i + 1);
      if (end === -1) throw new ExpressionSyntaxError('unterminated string literal', i, source);
      const text = source.slice(i + 1, end);
      tokens.push({ type: 'string', text, value: text, position: i });
      i = end + 1;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^-?[0-9]+(\.[0-9]+)?/.exec(source.slice(i));
      if (!match) throw new ExpressionSyntaxError('malformed number', i, source);
      tokens.push({
        type: 'number',
        text: match[0],
        value: Number(match[0]),
        position: i,
      });
      i += match[0].length;
      continue;
    }

    const operator = OPERATORS.find((op) => source.startsWith(op, i));
    if (operator) {
      // A lone `&` or `|` is a typo for the two-character form, not a bitwise operator.
      if ((char === '&' || char === '|') && operator.length === 1) {
        throw new ExpressionSyntaxError(`expected \`${char}${char}\``, i, source);
      }
      tokens.push({ type: 'operator', text: operator, position: i });
      i += operator.length;
      continue;
    }
    if (char === '&' || char === '|') {
      throw new ExpressionSyntaxError(`expected \`${char}${char}\``, i, source);
    }

    if (IDENT_START.test(char)) {
      let j = i;
      while (j < source.length && IDENT_CHAR.test(source[j]!)) j += 1;
      const word = source.slice(i, j);

      // `f.<fieldKey>` is the only dotted form; anything else dotted is a mistake.
      if (word === 'f' && source[j] === '.') {
        let k = j + 1;
        while (k < source.length && IDENT_CHAR.test(source[k]!)) k += 1;
        const fieldKey = source.slice(j + 1, k);
        if (fieldKey.length === 0) {
          throw new ExpressionSyntaxError('expected a field key after `f.`', j + 1, source);
        }
        // Same shape as `dslIdSchema`. Enforcing it here is what keeps `f.__proto__` from
        // being a legal reference that reads straight off Object.prototype at runtime.
        if (!FIELD_KEY.test(fieldKey)) {
          throw new ExpressionSyntaxError(
            `\`${fieldKey}\` is not a valid field key — expected lower_snake_case`,
            j + 1,
            source,
          );
        }
        tokens.push({ type: 'field', text: fieldKey, position: i });
        i = k;
        continue;
      }
      if (source[j] === '.') {
        throw new ExpressionSyntaxError(
          `unknown reference \`${word}.\` — field references are written \`f.<fieldKey>\``,
          i,
          source,
        );
      }

      if (word === 'true' || word === 'false') {
        tokens.push({ type: 'boolean', text: word, value: word === 'true', position: i });
      } else if (word === 'null') {
        tokens.push({ type: 'null', text: word, value: null, position: i });
      } else {
        tokens.push({ type: 'ident', text: word, position: i });
      }
      i = j;
      continue;
    }

    throw new ExpressionSyntaxError(`unexpected character \`${char}\``, i, source);
  }

  tokens.push({ type: 'eof', text: '', position: source.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): ExpressionNode {
    const node = this.parseOr();
    const token = this.peek();
    if (token.type !== 'eof') {
      throw this.fail(`unexpected \`${token.text}\``, token);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    const token = this.peek();
    if (token.type !== 'eof') this.index += 1;
    return token;
  }

  private fail(message: string, token: Token): ExpressionSyntaxError {
    return new ExpressionSyntaxError(message, token.position, this.source);
  }

  private parseOr(): ExpressionNode {
    let left = this.parseAnd();
    while (this.peek().type === 'operator' && this.peek().text === '||') {
      this.next();
      left = { kind: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): ExpressionNode {
    let left = this.parseComparison();
    while (this.peek().type === 'operator' && this.peek().text === '&&') {
      this.next();
      left = { kind: 'and', left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): ExpressionNode {
    if (this.peek().type === 'operator' && this.peek().text === '!') {
      this.next();
      return { kind: 'not', operand: this.parseComparison() };
    }

    const left = this.parseOperand();
    const token = this.peek();
    if (token.type === 'operator' && COMPARISONS.includes(token.text)) {
      this.next();
      return {
        kind: 'compare',
        op: token.text as ComparisonOperator,
        left,
        right: this.parseOperand(),
      };
    }
    return left;
  }

  private parseOperand(): ExpressionNode {
    const token = this.next();

    switch (token.type) {
      case 'lparen': {
        const inner = this.parseOr();
        const closing = this.next();
        if (closing.type !== 'rparen') throw this.fail('expected `)`', closing);
        return inner;
      }
      case 'field':
        return { kind: 'field', fieldKey: token.text };
      case 'number':
      case 'string':
      case 'boolean':
      case 'null':
        return { kind: 'literal', value: token.value as never };
      case 'ident': {
        if (!(expressionFunctions as readonly string[]).includes(token.text)) {
          throw this.fail(
            `unknown function \`${token.text}\` — the grammar allows ${expressionFunctions.join(', ')}`,
            token,
          );
        }
        const open = this.next();
        if (open.type !== 'lparen') throw this.fail(`expected \`(\` after \`${token.text}\``, open);

        const args: ExpressionNode[] = [];
        if (this.peek().type !== 'rparen') {
          for (;;) {
            args.push(this.parseOr());
            if (this.peek().type === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        const close = this.next();
        if (close.type !== 'rparen') throw this.fail('expected `)`', close);
        return { kind: 'call', fn: token.text as ExpressionFunction, args };
      }
      case 'operator':
        throw this.fail(`unexpected operator \`${token.text}\``, token);
      case 'eof':
        throw this.fail('unexpected end of expression', token);
      default:
        throw this.fail(`unexpected \`${token.text}\``, token);
    }
  }
}

/** Parses an expression string into an AST. Throws `ExpressionSyntaxError` on bad syntax. */
export function parseExpression(source: string): ExpressionNode {
  return new Parser(tokenize(source), source).parse();
}
