import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CompiledGraph } from './compiled.js';
import {
  evaluateRedFlags,
  evaluateValidations,
  localize,
  nextNode,
  startNode,
  type CommittedFields,
} from './interpreter.js';
import { validate } from './validate.js';

/**
 * Interpreter path tests over the real OPD document — the same file S04 will publish and a
 * clinic will actually run. Testing against a synthetic graph would prove the interpreter
 * agrees with the test author; testing against the pack proves the pack works.
 */

const packPath = fileURLToPath(
  new URL('../../../packs/opd-general/workflow.json', import.meta.url),
);
const graph: CompiledGraph = validate(JSON.parse(readFileSync(packPath, 'utf8')), {
  forPublish: true,
}).compiledGraph!;

/** Walks the graph the way the session engine will: answer, commit, ask for the next node. */
function walk(answers: Record<string, unknown>): { path: string[]; outcome: string } {
  const committed: Record<string, unknown> = {};
  const path: string[] = [];
  let current = startNode(graph);

  for (let step = 0; step < 50; step += 1) {
    path.push(current.id);
    if (current.fieldKey && current.fieldKey in answers) {
      committed[current.fieldKey] = answers[current.fieldKey];
    }
    const next = nextNode(graph, committed as CommittedFields, current.id);
    if (next.kind === 'end') return { path, outcome: next.outcome };
    current = next.node;
  }
  throw new Error('traversal did not terminate');
}

const baseAnswers = {
  chief_complaint: 'pain',
  symptom_duration: { value: 3, unit: 'days' },
  fever: false,
  cough: false,
  chest_pain: false,
  existing_conditions: ['none'],
  current_medications: 'none',
  has_allergy: false,
};

describe('traversal', () => {
  it('starts at the first node in the document', () => {
    expect(startNode(graph).id).toBe('info_welcome');
  });

  it('takes the short path when there is no chest pain and no allergy', () => {
    const { path, outcome } = walk(baseAnswers);
    expect(path).toEqual([
      'info_welcome',
      'q_chief_complaint',
      'q_duration',
      'q_fever',
      'q_cough',
      'q_chest_pain',
      'q_existing_conditions',
      'q_medications',
      'q_allergy',
      'end_done',
    ]);
    expect(outcome).toBe('completed');
  });

  it('resolves branch nodes transparently — the patient never sees one', () => {
    const { path } = walk(baseAnswers);
    expect(path).not.toContain('b_chest_pain');
  });

  it('asks about breathlessness only when there is chest pain', () => {
    expect(walk({ ...baseAnswers, chest_pain: true }).path).toContain('q_breathlessness');
    expect(walk(baseAnswers).path).not.toContain('q_breathlessness');
  });

  it('follows the transition list into the allergy detail question', () => {
    const withAllergy = walk({ ...baseAnswers, has_allergy: true, allergy_detail: 'penicillin' });
    expect(withAllergy.path).toContain('q_allergy_detail');
    expect(withAllergy.path.at(-1)).toBe('end_done');
  });

  it('is deterministic: the same answers produce the same path', () => {
    expect(walk(baseAnswers).path).toEqual(walk(baseAnswers).path);
  });

  it('reaches the end from every combination of the branching answers', () => {
    for (const chest_pain of [true, false]) {
      for (const has_allergy of [true, false]) {
        const result = walk({ ...baseAnswers, chest_pain, breathlessness: false, has_allergy });
        expect(result.outcome).toBe('completed');
      }
    }
  });

  it('throws on a node id that is not in the graph', () => {
    expect(() => nextNode(graph, {}, 'q_nonexistent')).toThrow(/not in this compiled graph/);
  });
});

describe('red flags', () => {
  it('raises nothing on an unremarkable intake', () => {
    expect(evaluateRedFlags(graph, { chest_pain: false, fever: false })).toEqual([]);
  });

  it('raises the high-severity flag for chest pain with breathlessness', () => {
    const raised = evaluateRedFlags(graph, { chest_pain: true, breathlessness: true });
    expect(raised.map((flag) => flag.id)).toContain('chest_pain_breathless');
    const flag = raised.find((f) => f.id === 'chest_pain_breathless')!;
    expect(flag.severity).toBe('high');
    expect(flag.escalation).toBe('alert_staff_immediately');
    expect(flag.patientMessage?.en).toBe('A staff member will come to you shortly.');
  });

  it('does not raise it for chest pain alone', () => {
    const raised = evaluateRedFlags(graph, { chest_pain: true, breathlessness: false });
    expect(raised.map((flag) => flag.id)).not.toContain('chest_pain_breathless');
  });

  it('does not raise it before breathlessness has been asked', () => {
    expect(evaluateRedFlags(graph, { chest_pain: true }).map((f) => f.id)).not.toContain(
      'chest_pain_breathless',
    );
  });

  it('returns the worst flag first', () => {
    const raised = evaluateRedFlags(graph, {
      chest_pain: true,
      breathlessness: true,
      fever: true,
      symptom_duration: { value: 10, unit: 'days' },
    });
    expect(raised.length).toBe(2);
    expect(raised[0]?.severity).toBe('high');
  });
});

describe('cross-field validations', () => {
  it('stays quiet when the guard does not hold', () => {
    expect(evaluateValidations(graph, { has_allergy: false })).toEqual([]);
  });

  it('reports the breach when an allergy is claimed but not named', () => {
    const breaches = evaluateValidations(graph, { has_allergy: true });
    expect(breaches.map((b) => b.id)).toEqual(['allergy_named']);
    expect(breaches[0]?.severity).toBe('warn');
  });

  it('clears once the medicine is named', () => {
    expect(evaluateValidations(graph, { has_allergy: true, allergy_detail: 'penicillin' })).toEqual(
      [],
    );
  });
});

describe('localization', () => {
  it('prefers the requested language', () => {
    expect(localize(graph.nodes.q_fever?.prompt, 'hi', graph.fallbackLanguage)).toBe(
      'क्या इस समय आपको बुखार है?',
    );
  });

  it('falls back to the document language when a translation is missing', () => {
    expect(localize({ en: 'Only English' }, 'mr', 'en')).toBe('Only English');
  });
});
