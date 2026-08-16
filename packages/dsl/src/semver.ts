import { workflowDocumentSchema, type WorkflowDocument } from '@dhara/contracts';

/**
 * Version bumping for published workflows (doc 06 §8).
 *
 * The rules are about *session compatibility*, not about how much work the edit was. A
 * session pins an exact version, so the question a bump answers is: can an analysis that
 * spans versions still line the two up field-for-field?
 *
 *   major — a removed or renamed field, or a changed answer type. Old data no longer maps.
 *   minor — a new node or field. Old data maps; new data has more of it.
 *   patch — text and translations only. The dataset is unchanged.
 *
 * Computed rather than author-declared, because "it's only a text change" is exactly the
 * claim that turns out to be wrong.
 */

export type BumpKind = 'major' | 'minor' | 'patch';

export const INITIAL_SEMVER = '1.0.0';

export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(value: string): SemverParts | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatSemver(parts: SemverParts): string {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

export function bumpSemver(previous: string, kind: BumpKind): string {
  const parts = parseSemver(previous);
  if (!parts) return INITIAL_SEMVER;
  switch (kind) {
    case 'major':
      return formatSemver({ major: parts.major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatSemver({ major: parts.major, minor: parts.minor + 1, patch: 0 });
    case 'patch':
      return formatSemver({ major: parts.major, minor: parts.minor, patch: parts.patch + 1 });
  }
}

/** Classifies the change between two documents. A missing previous document → major. */
export function classifyChange(previous: unknown, next: WorkflowDocument): BumpKind {
  if (typeof previous !== 'object' || previous === null) return 'major';

  // Both sides are normalized through the schema before comparison. Without this, an
  // omitted `confirm` on one side and an explicit `"lowConfidence"` on the other read as a
  // structural change, and every republish would claim to be minor.
  const parsedPrevious = workflowDocumentSchema.safeParse(previous);
  const before: Partial<WorkflowDocument> = parsedPrevious.success
    ? parsedPrevious.data
    : (previous as Partial<WorkflowDocument>);

  const beforeFields = before.fields ?? {};
  const afterFields = next.fields;

  for (const [key, field] of Object.entries(beforeFields)) {
    const after = afterFields[key];
    // A removed field takes its history with it; a renamed one looks identical to this
    // check, which is the point — there is no safe way to tell them apart from outside.
    if (!after) return 'major';
    if (after.type !== field.type) return 'major';
    if (after.required && !field.required) return 'major';
  }

  const beforeNodeIds = new Set((before.nodes ?? []).map((node) => node.id));
  for (const id of beforeNodeIds) {
    if (!next.nodes.some((node) => node.id === id)) return 'major';
  }

  // Anything left is additive or behavioural. `patch` is reserved for documents that are
  // identical once every human-readable string is removed — that is what "text and
  // translation changes" means operationally, and it is checkable rather than asserted.
  return JSON.stringify(withoutText(before)) === JSON.stringify(withoutText(next))
    ? 'patch'
    : 'minor';
}

/** Localized-text keys, stripped before the structural comparison above. */
const TEXT_KEYS = new Set([
  'title',
  'prompt',
  'helpText',
  'label',
  'text',
  'patientMessage',
  'message',
  'staffNote',
  'synonyms',
  'trueSynonyms',
  'falseSynonyms',
  'unitSynonyms',
  'changelog',
]);

function withoutText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutText);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !TEXT_KEYS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, withoutText(child)]),
  );
}
