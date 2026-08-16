import { describe, expect, it } from 'vitest';
import { workflowDocumentSchema } from '@dhara/contracts';
import { bumpSemver, classifyChange, INITIAL_SEMVER, parseSemver } from './semver.js';
import { validDocument } from './validate.test.js';

/** Version bumping (doc 06 §8): the rule is session compatibility, not effort. */

const parse = (doc: unknown) => workflowDocumentSchema.parse(doc);

describe('bumpSemver', () => {
  it.each([
    ['1.0.0', 'patch', '1.0.1'],
    ['1.0.1', 'minor', '1.1.0'],
    ['1.4.2', 'major', '2.0.0'],
  ] as const)('bumps %s by %s to %s', (from, kind, expected) => {
    expect(bumpSemver(from, kind)).toBe(expected);
  });

  it('falls back to the initial version when the previous one is unparseable', () => {
    expect(parseSemver('draft')).toBeNull();
    expect(bumpSemver('draft', 'patch')).toBe(INITIAL_SEMVER);
  });
});

describe('classifyChange', () => {
  it('calls a translation edit a patch', () => {
    const before = validDocument();
    const after = validDocument();
    after.nodes[0].prompt.hi = 'क्या आपकी छाती में दर्द है?';
    after.title.en = 'Fixture v2';
    expect(classifyChange(before, parse(after))).toBe('patch');
  });

  it('calls an added optional field a minor change', () => {
    const before = validDocument();
    const after = validDocument();
    after.fields.notes = { type: 'text', required: false };
    after.nodes.splice(3, 0, {
      id: 'q_notes',
      type: 'question',
      fieldKey: 'notes',
      prompt: { en: 'Anything else?', hi: 'और कुछ?' },
      next: 'end_done',
    });
    after.nodes[2].next = 'q_notes';
    expect(classifyChange(before, parse(after))).toBe('minor');
  });

  it('calls a rerouted flow a minor change even with no new fields', () => {
    const before = validDocument();
    const after = validDocument();
    after.nodes[0].next = 'q_symptoms';
    expect(classifyChange(before, parse(after))).toBe('minor');
  });

  it('calls a removed field a major change', () => {
    const before = validDocument();
    const after = validDocument();
    delete after.fields.symptoms;
    after.nodes.splice(2, 1);
    after.nodes[1].next = 'end_done';
    expect(classifyChange(before, parse(after))).toBe('major');
  });

  it('calls a changed answer type a major change', () => {
    const before = validDocument();
    const after = validDocument();
    after.fields.chest_pain = { type: 'text', required: true };
    expect(classifyChange(before, parse(after))).toBe('major');
  });

  it('calls a newly required field a major change', () => {
    const before = validDocument();
    const after = validDocument();
    after.fields.symptoms.required = true;
    expect(classifyChange(before, parse(after))).toBe('major');
  });

  it('treats an absent previous document as major', () => {
    expect(classifyChange(null, parse(validDocument()))).toBe('major');
  });
});
