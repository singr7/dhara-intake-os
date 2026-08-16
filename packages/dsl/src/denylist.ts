/**
 * The patient-facing language deny-list (ADR-015, doc 09 §1).
 *
 * The product boundary is absolute: Dhara collects intake information, it never tells a
 * patient what is wrong with them or what to do about it. That boundary is easy to state
 * and easy to erode one well-meaning sentence at a time — "this looks like a chest
 * infection", "you should take paracetamol" — so it is enforced mechanically. Every string
 * a patient can see (prompts, help text, option labels, consent text, red-flag messages,
 * validation messages) is scanned at validation time, and a hit is an **error**, not a
 * warning: the document does not publish.
 *
 * The seed list below is deliberately blunt. Refining it is a clinical-review task, not an
 * engineering one, and a false positive costs an author one rewording while a false
 * negative costs a patient. Staff-facing strings (`staffNote`, node `reason`, `label`) are
 * exempt — clinicians talking to clinicians is the whole point of the summary.
 */

/**
 * Where a rule applies.
 *
 * `question` covers anything the patient is being *asked* — prompts, help text, answer
 * option labels. `statement` covers anything the system *tells* the patient — info nodes,
 * end screens, red-flag messages, validation messages, consent text.
 *
 * The distinction matters because the same words mean opposite things in the two places.
 * "Do you have diabetes?" is intake — it is the patient asserting a fact about themselves,
 * and an OPD form that cannot ask it is useless. "You have diabetes" is a diagnosis, and
 * Dhara does not make those. Rules that would block legitimate history-taking are therefore
 * scoped to `statement`; everything categorically wrong in either place stays global.
 */
export type DenyScope = 'question' | 'statement';

export interface DenyListRule {
  /** Stable identifier so a suppression, if we ever add one, can name what it suppresses. */
  id: string;
  pattern: RegExp;
  scopes: readonly DenyScope[];
  /** What the author should do instead — the message is the whole value of the check. */
  guidance: string;
}

const EVERYWHERE = ['question', 'statement'] as const;

/**
 * Two things about the patterns.
 *
 * They are stateless — no `g` flag — because they are reused across thousands of strings and
 * a `lastIndex` carried between calls is a heisenbug nobody would find.
 *
 * And the Devanagari alternatives sit *outside* the `\b(?:…)\b` group rather than inside
 * it. `\b` is an ASCII word boundary: Devanagari letters are not `\w`, so a boundary never
 * matches next to one and any pattern of the form `\b(?:…|निदान)\b` silently matches only
 * its English half. The Hindi cases are covered by a test for exactly that reason.
 */
export const denyListRules: DenyListRule[] = [
  {
    id: 'diagnosis',
    scopes: EVERYWHERE,
    pattern: /\b(?:diagnos\w*)\b|निदान/iu,
    guidance: 'Intake never names a diagnosis. Ask about symptoms instead.',
  },
  {
    id: 'prescription',
    scopes: EVERYWHERE,
    pattern: /\b(?:prescri\w*)\b|दवा लिख/iu,
    guidance: 'Intake never prescribes. Record current medications as an answer instead.',
  },
  {
    id: 'treatment',
    scopes: EVERYWHERE,
    pattern: /\b(?:treatment|treat|therapy)\b|इलाज|उपचार/iu,
    guidance: 'Intake never proposes treatment. Route to a clinician instead.',
  },
  {
    id: 'second-person-condition',
    scopes: ['statement'],
    pattern: /\b(?:you have|you are having|you may have|you might have)\b|आपको\s.*है/iu,
    guidance:
      'Telling a patient what they have is a diagnosis. Say what happens next instead — ' +
      '"a staff member will assist you shortly".',
  },
  {
    id: 'advice',
    scopes: EVERYWHERE,
    pattern: /\b(?:you should|you must|we recommend|advise|advice)\b|सलाह/iu,
    guidance: 'Intake gives no medical advice. State the next step, not a recommendation.',
  },
  {
    id: 'dosage',
    scopes: EVERYWHERE,
    pattern: /\b\d+\s?(mg|ml|mcg|tablets?|doses?)\b/iu,
    guidance: 'A dosage in patient-facing text reads as a prescription. Remove it.',
  },
  {
    id: 'reassurance-about-severity',
    scopes: ['statement'],
    pattern:
      /\b(?:nothing serious|not serious|don'?t worry|no need to worry)\b|चिंता की बात नहीं/iu,
    guidance:
      'Reassurance about severity is a clinical judgement. Say only what the workflow will do next.',
  },
  {
    /**
     * Placeholder per the S03 task list: a named-condition list belongs to the clinical
     * pack review (M5), not to this file. These are the conditions whose names most often
     * turn up in draft copy as "possible X" — enough to catch the common slip today.
     */
    id: 'condition-names',
    scopes: ['statement'],
    pattern:
      /\b(?:cancer|tuberculosis|tb|diabetes|dengue|malaria|typhoid|covid|pneumonia|stroke|heart attack)\b|कैंसर|मधुमेह|डेंगू|मलेरिया/iu,
    guidance:
      'Naming a condition to a patient implies a diagnosis. Ask about symptoms, or refer to ' +
      '"your existing conditions" generically.',
  },
];

export interface DenyListHit {
  ruleId: string;
  /** The exact text that matched, so the author can find it in a long string. */
  match: string;
  guidance: string;
}

/** Scans one patient-facing string. Returns every rule it trips, not just the first. */
export function scanForDeniedLanguage(text: string, scope: DenyScope = 'statement'): DenyListHit[] {
  const hits: DenyListHit[] = [];
  for (const rule of denyListRules) {
    if (!rule.scopes.includes(scope)) continue;
    const match = rule.pattern.exec(text);
    if (match) hits.push({ ruleId: rule.id, match: match[0], guidance: rule.guidance });
  }
  return hits;
}
