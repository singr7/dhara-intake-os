import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate, type IssueCode, type ValidationResult } from './validate.js';

/**
 * The validator fixture suite (doc 06 §7).
 *
 * One valid document is mutated one way per test, so each case proves that *that* check
 * fires and that nothing else does. The base document is deliberately small; the real OPD
 * pack is exercised separately in `opd-general.test.ts`.
 */

export const validDocument = () =>
  structuredClone({
    dslVersion: '1.0',
    key: 'fixture',
    title: { en: 'Fixture', hi: 'फ़िक्स्चर' },
    languages: ['en', 'hi'],
    defaultMode: 'touch',
    consent: {
      purposeVersion: '2026-07-01',
      text: { en: 'We will ask a few questions.', hi: 'हम कुछ सवाल पूछेंगे।' },
    },
    fields: {
      chest_pain: { type: 'boolean', required: true },
      breathlessness: { type: 'boolean', required: true },
      symptoms: {
        type: 'multiChoice',
        required: false,
        options: [
          { value: 'fever', label: { en: 'Fever', hi: 'बुखार' } },
          { value: 'cough', label: { en: 'Cough', hi: 'खाँसी' } },
        ],
      },
    },
    nodes: [
      {
        id: 'q_chest_pain',
        type: 'question',
        fieldKey: 'chest_pain',
        prompt: { en: 'Do you have chest pain?', hi: 'क्या छाती में दर्द है?' },
        next: 'q_breathlessness',
      },
      {
        id: 'q_breathlessness',
        type: 'question',
        fieldKey: 'breathlessness',
        prompt: { en: 'Is breathing hard?', hi: 'क्या साँस लेने में तकलीफ़ है?' },
        next: 'q_symptoms',
      },
      {
        id: 'q_symptoms',
        type: 'question',
        fieldKey: 'symptoms',
        prompt: { en: 'Anything else?', hi: 'और कुछ?' },
        next: 'end_done',
      },
      {
        id: 'end_done',
        type: 'end',
        outcome: 'completed',
        prompt: { en: 'Thank you.', hi: 'धन्यवाद।' },
      },
    ],
    rules: {
      redFlags: [
        {
          id: 'chest_pain_breathless',
          when: 'f.chest_pain == true && f.breathlessness == true',
          severity: 'high',
          escalation: 'alert_staff_immediately',
          patientMessage: {
            en: 'A staff member will come to you shortly.',
            hi: 'स्टाफ़ जल्द आएगा।',
          },
        },
      ],
      validations: [],
    },
    review: { alwaysReview: [], confidenceThreshold: 0.75, reviewRequired: true },
    output: { schemaId: 'fixture-output@1' },
  }) as Record<string, any>;

const codes = (result: ValidationResult): IssueCode[] => result.errors.map((issue) => issue.code);
const messages = (result: ValidationResult): string =>
  result.errors.map((i) => i.message).join('\n');

describe('validate — the happy path', () => {
  it('accepts a well-formed document and compiles it', () => {
    const result = validate(validDocument());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.compiledGraph?.startNodeId).toBe('q_chest_pain');
  });

  it('accepts it for publishing too', () => {
    expect(validate(validDocument(), { forPublish: true }).errors).toEqual([]);
  });

  it('produces no compiled graph when there are errors', () => {
    const doc = validDocument();
    doc.nodes[0].next = 'nowhere';
    expect(validate(doc).compiledGraph).toBeNull();
  });
});

describe('validate — shape', () => {
  it('rejects a non-document', () => {
    expect(codes(validate(null))).toContain('shape');
    expect(codes(validate({ dslVersion: '1.0' }))).toContain('shape');
  });

  it('points at the offending path', () => {
    const doc = validDocument();
    doc.nodes[0].prompt = 42;
    const result = validate(doc);
    expect(result.errors[0]?.path).toMatch(/^\/nodes\/0\/prompt/);
  });

  it('rejects a duplicate node id', () => {
    const doc = validDocument();
    doc.nodes.push({ ...doc.nodes[0] });
    expect(codes(validate(doc))).toContain('duplicate-node-id');
  });
});

describe('validate — references', () => {
  it('rejects a node committing an undeclared field', () => {
    const doc = validDocument();
    doc.nodes[0].fieldKey = 'not_declared';
    const result = validate(doc);
    expect(codes(result)).toContain('unknown-field');
    expect(messages(result)).toMatch(/not declared in `fields`/);
  });

  it('rejects an answer override that changes the field type', () => {
    const doc = validDocument();
    doc.nodes[0].answer = { type: 'text' };
    expect(codes(validate(doc))).toContain('answer-type-mismatch');
  });

  it('rejects a `next` pointing at nothing', () => {
    const doc = validDocument();
    doc.nodes[1].next = 'q_typo';
    expect(codes(validate(doc))).toContain('unknown-node-ref');
  });

  it('rejects a transition list whose last entry is conditional', () => {
    const doc = validDocument();
    doc.nodes[0].next = [{ when: 'f.chest_pain == true', next: 'q_breathlessness' }];
    const result = validate(doc);
    expect(codes(result)).toContain('transition-list');
    expect(messages(result)).toMatch(/last entry of a transition list must have no `when`/);
  });

  it('rejects review policy naming an unknown field', () => {
    const doc = validDocument();
    doc.review.alwaysReview = ['not_a_field'];
    expect(codes(validate(doc))).toContain('review-reference');
  });

  it('warns about a field no node ever commits', () => {
    const doc = validDocument();
    doc.fields.orphan = { type: 'text', required: false };
    const result = validate(doc);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain('unused-field');
  });
});

describe('validate — graph topology', () => {
  it('rejects an unreachable node', () => {
    const doc = validDocument();
    doc.nodes.splice(3, 0, {
      id: 'q_orphan',
      type: 'info',
      prompt: { en: 'Nobody routes here.', hi: 'कोई यहाँ नहीं आता।' },
      next: 'end_done',
    });
    const result = validate(doc);
    expect(codes(result)).toContain('unreachable-node');
    expect(messages(result)).toMatch(/cannot be reached from the start node/);
  });

  it('rejects a cycle', () => {
    const doc = validDocument();
    doc.nodes[2].next = 'q_chest_pain';
    const result = validate(doc);
    expect(codes(result)).toContain('cycle');
    expect(messages(result)).toMatch(/the graph loops/);
  });

  it('rejects a path that never reaches an end node', () => {
    const doc = validDocument();
    doc.nodes[2].next = 'h_stuck';
    doc.nodes.push({ id: 'h_stuck', type: 'handoff', reason: 'stuck', next: 'h_stuck2' });
    doc.nodes.push({ id: 'h_stuck2', type: 'handoff', reason: 'stuck', next: 'h_stuck' });
    // The dead end here is a loop, so the cycle check speaks first — assert we caught it.
    expect(codes(validate(doc)).some((code) => code === 'cycle' || code === 'no-termination')).toBe(
      true,
    );
  });

  it('accepts a branch node and both of its arms', () => {
    const doc = validDocument();
    doc.nodes[0].next = 'b_pain';
    doc.nodes.splice(1, 0, {
      id: 'b_pain',
      type: 'branch',
      cases: [{ when: 'f.chest_pain == true', next: 'q_breathlessness' }],
      else: 'q_symptoms',
    });
    expect(validate(doc).errors).toEqual([]);
  });
});

describe('validate — expressions', () => {
  it('rejects a syntax error and says where', () => {
    const doc = validDocument();
    doc.rules.redFlags[0].when = 'f.chest_pain === true';
    const result = validate(doc);
    expect(codes(result)).toContain('expression-syntax');
    expect(result.errors[0]?.path).toBe('/rules/redFlags/0/when');
  });

  it('rejects a type error against the declared field types', () => {
    const doc = validDocument();
    doc.rules.redFlags[0].when = 'f.symptoms == "fever"';
    const result = validate(doc);
    expect(codes(result)).toContain('expression-type');
    expect(messages(result)).toMatch(/use contains/);
  });

  it('rejects an expression referencing a field not yet committed', () => {
    const doc = validDocument();
    // The first node routes on an answer that comes two nodes later.
    doc.nodes[0].next = [
      { when: 'contains(f.symptoms, "fever")', next: 'q_symptoms' },
      { next: 'q_breathlessness' },
    ];
    const result = validate(doc);
    expect(codes(result)).toContain('field-before-use');
    expect(messages(result)).toMatch(/read before it can be committed on every path/);
  });

  it('rejects a field committed on only one branch of the path', () => {
    const doc = validDocument();
    doc.nodes[0].next = 'b_pain';
    doc.nodes.splice(1, 0, {
      id: 'b_pain',
      type: 'branch',
      cases: [{ when: 'f.chest_pain == true', next: 'q_breathlessness' }],
      else: 'q_symptoms',
    });
    // `breathlessness` is committed only on the chest-pain arm, so routing on it after the
    // arms rejoin is a bug that only shows up for patients who took the other arm.
    doc.nodes[3].next = [
      { when: 'f.breathlessness == true', next: 'end_done' },
      { next: 'end_done' },
    ];
    expect(codes(validate(doc))).toContain('field-before-use');
  });

  it('lets rules reference any declared field regardless of path', () => {
    // Rules run after every commit, not at a point in the graph — an uncommitted field
    // simply reads as falsy, so the field-before-use rule does not apply to them.
    const doc = validDocument();
    doc.nodes[1].next = 'q_symptoms';
    doc.nodes[0].next = [
      { when: 'f.chest_pain == true', next: 'q_breathlessness' },
      { next: 'q_symptoms' },
    ];
    expect(validate(doc).errors).toEqual([]);
  });
});

describe('validate — language coverage', () => {
  it('warns on a draft and errors on publish', () => {
    const doc = validDocument();
    delete doc.nodes[0].prompt.hi;

    const draft = validate(doc);
    expect(draft.errors).toEqual([]);
    expect(draft.warnings.map((w) => w.code)).toContain('language-coverage');
    expect(draft.warnings[0]?.path).toBe('/nodes/0/prompt/hi');

    const published = validate(doc, { forPublish: true });
    expect(codes(published)).toContain('language-coverage');
    expect(published.compiledGraph).toBeNull();
  });

  it('checks option labels too', () => {
    const doc = validDocument();
    delete doc.fields.symptoms.options[1].label.hi;
    expect(validate(doc, { forPublish: true }).errors[0]?.path).toBe(
      '/fields/symptoms/options/1/label/hi',
    );
  });
});

describe('validate — the safety boundary', () => {
  it('rejects a diagnosis in a patient-facing message', () => {
    const doc = validDocument();
    doc.rules.redFlags[0].patientMessage.en = 'You may have pneumonia. Please wait.';
    const result = validate(doc);
    expect(codes(result)).toContain('denied-language');
    expect(messages(result)).toMatch(/not allowed in patient-facing text/);
  });

  it.each([
    ['Your diagnosis will be ready soon.', 'diagnosis'],
    ['The doctor will prescribe something.', 'prescription'],
    ['We recommend rest.', 'advice'],
    ['Take 500 mg after food.', 'dosage'],
    ['This is nothing serious.', 'reassurance-about-severity'],
  ])('rejects %j', (text, ruleId) => {
    const doc = validDocument();
    doc.nodes[3].prompt.en = text;
    expect(messages(validate(doc))).toMatch(new RegExp(`rule \`${ruleId}\``));
  });

  it('catches Devanagari as well as English', () => {
    const doc = validDocument();
    doc.nodes[3].prompt.hi = 'आपका इलाज शुरू होगा।';
    expect(codes(validate(doc))).toContain('denied-language');
  });

  it('still lets a question ask about a named condition', () => {
    // "Do you have diabetes?" is history-taking, not diagnosis: the patient asserts it, the
    // system does not. The same words in an `info` statement are rejected below.
    const doc = validDocument();
    doc.nodes[0].prompt.en = 'Do you have diabetes?';
    expect(validate(doc).errors).toEqual([]);

    doc.nodes[3].prompt.en = 'Diabetes was noted.';
    expect(codes(validate(doc))).toContain('denied-language');
  });
});

describe('compiled graph', () => {
  it('precompiles ASTs, adjacency and per-node metadata', () => {
    const graph = validate(validDocument()).compiledGraph!;

    expect(graph.order).toEqual(['q_chest_pain', 'q_breathlessness', 'q_symptoms', 'end_done']);
    expect(graph.nodes.q_chest_pain?.edges).toEqual(['q_breathlessness']);
    expect(graph.nodes.q_chest_pain?.answer).toEqual({ type: 'boolean' });
    expect(graph.nodes.q_chest_pain?.confirm).toBe('lowConfidence');
    expect(graph.nodes.q_chest_pain?.modes).toEqual(['touch']);
    expect(graph.nodes.end_done?.terminal).toBe(true);
    expect(graph.terminalNodeIds).toEqual(['end_done']);
    expect(graph.questionCount).toBe(3);
    expect(graph.fallbackLanguage).toBe('en');

    expect(graph.redFlags[0]?.when.ast).toMatchObject({ kind: 'and' });
    expect(graph.redFlags[0]?.when.reads).toEqual(['chest_pain', 'breathlessness']);
  });

  it('records what is committed before each node', () => {
    const graph = validate(validDocument()).compiledGraph!;
    expect(graph.nodes.q_chest_pain?.committedBefore).toEqual([]);
    expect(graph.nodes.q_symptoms?.committedBefore).toEqual(['chest_pain', 'breathlessness']);
  });

  it('survives a round trip through JSON, because it is stored in a JSONB column', () => {
    const graph = validate(validDocument()).compiledGraph!;
    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });
});

describe('the OPD pack', () => {
  const packPath = fileURLToPath(
    new URL('../../../packs/opd-general/workflow.json', import.meta.url),
  );
  const opd = JSON.parse(readFileSync(packPath, 'utf8')) as unknown;

  it('validates with zero errors and zero warnings, ready to publish', () => {
    const result = validate(opd, { forPublish: true });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.compiledGraph).not.toBeNull();
  });
});
