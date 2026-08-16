import { describe, expect, it } from 'vitest';
import { referencedFields } from './ast.js';
import { ExpressionSyntaxError, parseExpression } from './parse.js';
import { ExpressionRuntimeError, evaluateExpression } from './evaluate.js';
import { typeCheckCondition, typeCheckExpression, type ValueType } from './typecheck.js';

/**
 * The expression grammar (doc 06 §4). These tests are the specification of what a DSL
 * author may write, so they enumerate rather than sample: precedence, every function, every
 * comparison, and the ways each of them can be wrong.
 */

const fields = {
  fever: true,
  cough: false,
  age: 34,
  chief_complaint: 'pain',
  symptoms: ['fever', 'cough'],
  dob: '1990-06-15',
  notes: 'chest pain since morning',
  duration: { value: 3, unit: 'days' as const },
};

const evaluate = (source: string, overrides: Record<string, unknown> = {}): unknown =>
  evaluateExpression(parseExpression(source), {
    f: { ...fields, ...overrides } as never,
    now: new Date('2026-08-16T00:00:00Z'),
  });

describe('parser', () => {
  it('parses field references, literals and calls', () => {
    expect(parseExpression('f.fever')).toEqual({ kind: 'field', fieldKey: 'fever' });
    expect(parseExpression('42')).toEqual({ kind: 'literal', value: 42 });
    expect(parseExpression('-7')).toEqual({ kind: 'literal', value: -7 });
    expect(parseExpression('"pain"')).toEqual({ kind: 'literal', value: 'pain' });
    expect(parseExpression("'pain'")).toEqual({ kind: 'literal', value: 'pain' });
    expect(parseExpression('null')).toEqual({ kind: 'literal', value: null });
    expect(parseExpression('exists(f.fever)')).toEqual({
      kind: 'call',
      fn: 'exists',
      args: [{ kind: 'field', fieldKey: 'fever' }],
    });
  });

  it('binds && tighter than ||', () => {
    // a || (b && c) — not (a || b) && c.
    const ast = parseExpression('f.fever || f.cough && f.age > 30');
    expect(ast.kind).toBe('or');
    expect(ast.kind === 'or' && ast.right.kind).toBe('and');
  });

  it('binds comparison tighter than &&', () => {
    const ast = parseExpression('f.age > 30 && f.fever');
    expect(ast.kind).toBe('and');
    expect(ast.kind === 'and' && ast.left.kind).toBe('compare');
  });

  it('lets parentheses override precedence', () => {
    const ast = parseExpression('(f.fever || f.cough) && f.age > 30');
    expect(ast.kind).toBe('and');
    expect(ast.kind === 'and' && ast.left.kind).toBe('or');
  });

  it('parses ! as a prefix on the whole comparison chain', () => {
    expect(parseExpression('!f.fever')).toEqual({
      kind: 'not',
      operand: { kind: 'field', fieldKey: 'fever' },
    });
    expect(parseExpression('!exists(f.notes)').kind).toBe('not');
  });

  it.each([
    ['f.', 'expected a field key'],
    ['f.fever &&', 'unexpected end of expression'],
    ['f.fever & f.cough', 'expected `&&`'],
    ['(f.fever', 'expected `)`'],
    ['"unterminated', 'unterminated string literal'],
    ['g.fever', 'unknown reference'],
    ['lookup(f.fever)', 'unknown function'],
    ['f.fever f.cough', 'unexpected'],
    ['f.age # 3', 'unexpected character'],
  ])('rejects `%s`', (source, fragment) => {
    expect(() => parseExpression(source)).toThrow(ExpressionSyntaxError);
    expect(() => parseExpression(source)).toThrow(
      new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('names the position of a syntax error', () => {
    try {
      parseExpression('f.fever && & f.cough');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionSyntaxError);
      expect((error as ExpressionSyntaxError).position).toBe(11);
    }
  });

  it('has no way to reach the host: identifiers are functions or nothing', () => {
    for (const attempt of [
      'constructor',
      'process.exit(1)',
      'globalThis',
      'f.__proto__',
      '[].constructor',
    ]) {
      expect(() => parseExpression(attempt)).toThrow(ExpressionSyntaxError);
    }
  });

  it('lists referenced fields in first-seen order', () => {
    expect(referencedFields(parseExpression('f.b == 1 && (f.a || f.b)'))).toEqual(['b', 'a']);
  });
});

describe('evaluator', () => {
  it.each([
    ['f.fever', true],
    ['!f.fever', false],
    ['f.fever && f.cough', false],
    ['f.fever || f.cough', true],
    ['f.age > 30', true],
    ['f.age >= 34', true],
    ['f.age < 30', false],
    ['f.age <= 34', true],
    ['f.chief_complaint == "pain"', true],
    ['f.chief_complaint != "fever"', true],
    ['exists(f.notes)', true],
    ['exists(f.missing)', false],
    ['contains(f.symptoms, "fever")', true],
    ['contains(f.symptoms, "rash")', false],
    ['contains(f.notes, "chest")', true],
    ['count(f.symptoms)', 2],
    ['count(f.missing)', 0],
    ['ageYears(f.dob)', 36],
    ['f.duration == null', false],
    ['f.missing == null', true],
  ])('evaluates `%s`', (source, expected) => {
    expect(evaluate(source)).toBe(expected);
  });

  it('short-circuits && so a guarded comparison is safe', () => {
    expect(evaluate('exists(f.missing) && f.missing > 5')).toBe(false);
  });

  it('treats an uncommitted field as falsy rather than throwing', () => {
    expect(evaluate('f.never_asked')).toBeUndefined();
    expect(evaluate('f.never_asked || f.fever')).toBe(true);
    expect(evaluate('f.never_asked > 5')).toBe(false);
  });

  it('throws on a genuine type misuse', () => {
    expect(() => evaluate('f.age && f.fever')).toThrow(ExpressionRuntimeError);
    expect(() => evaluate('f.symptoms == "fever"')).toThrow(/lists cannot be compared/);
    expect(() => evaluate('count(f.age)')).toThrow(/count\(\) needs a list/);
    expect(() => evaluate('f.chief_complaint > 3')).toThrow(/two numbers or two dates/);
  });

  it('uses the injected clock for ageYears', () => {
    expect(
      evaluateExpression(parseExpression('ageYears(f.dob)'), {
        f: { dob: '1990-06-15' },
        now: new Date('2026-06-14T00:00:00Z'),
      }),
    ).toBe(35);
  });
});

describe('type checker', () => {
  const fieldTypes: Record<string, ValueType> = {
    fever: 'boolean',
    age: 'number',
    chief_complaint: 'string',
    symptoms: 'stringList',
    dob: 'date',
    duration: 'duration',
    scan: 'media',
  };

  const check = (source: string): string[] =>
    typeCheckExpression(parseExpression(source), { fieldTypes }).map((issue) => issue.message);

  it.each([
    'f.fever',
    'f.fever && !f.fever',
    'f.age > 30',
    'f.chief_complaint == "pain"',
    'exists(f.symptoms)',
    'contains(f.symptoms, "fever")',
    'count(f.symptoms) > 1',
    'ageYears(f.dob) >= 18',
    'f.duration != null',
  ])('accepts `%s`', (source) => {
    expect(check(source)).toEqual([]);
  });

  it('rejects an unknown field', () => {
    expect(check('f.nonexistent == 1')[0]).toMatch(/unknown field `f.nonexistent`/);
  });

  it('rejects comparing different types', () => {
    expect(check('f.age == "thirty"')[0]).toMatch(/compares a number field with a text field/);
    expect(check('f.fever == "yes"')[0]).toMatch(/same type/);
  });

  it('rejects == against a multi-choice field and says what to use instead', () => {
    expect(check('f.symptoms == "fever"')[0]).toMatch(/use contains\(f\.x, "value"\) or count/);
  });

  it('rejects ordering on non-numbers', () => {
    expect(check('f.chief_complaint > 3')[0]).toMatch(/two numbers or two dates/);
    expect(check('f.duration > 3')[0]).toMatch(/two numbers or two dates/);
  });

  it('rejects boolean operators over non-booleans', () => {
    expect(check('f.age && f.fever')[0]).toMatch(/`&&` needs yes\/no operands/);
  });

  it('rejects wrong function arguments and arity', () => {
    expect(check('count(f.age)')[0]).toMatch(/count\(\) needs a multi-choice field/);
    expect(check('ageYears(f.age)')[0]).toMatch(/ageYears\(\) needs a date field/);
    expect(check('contains(f.age, "x")')[0]).toMatch(/contains\(\) needs a multi-choice or text/);
    expect(check('exists(f.fever, f.age)')[0]).toMatch(/exists\(\) takes 1 argument, got 2/);
  });

  it('requires a condition to evaluate to yes/no', () => {
    const issues = typeCheckCondition(parseExpression('f.age'), { fieldTypes });
    expect(issues[0]?.message).toMatch(/must evaluate to yes\/no/);
    expect(typeCheckCondition(parseExpression('f.age > 3'), { fieldTypes })).toEqual([]);
  });

  it('reports a field that is not yet available', () => {
    const issues = typeCheckExpression(parseExpression('f.age > 3'), {
      fieldTypes,
      available: new Set(['fever']),
    });
    expect(issues[0]?.message).toMatch(/is read before it can be committed/);
  });
});
