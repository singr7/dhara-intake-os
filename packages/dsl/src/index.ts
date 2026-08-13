/**
 * @dhara/dsl — Workflow DSL parser, validator, graph checks and pure interpreter (doc 06).
 *
 * S01 ships the package boundary only. S03 implements: expression grammar parser (no eval),
 * `validate(doc)` with reachability/termination/type/deny-list checks, `compiledGraph`, and
 * the pure interpreter (`nextNode`, `evaluateRedFlags`) that the S04 session engine drives.
 */

export const DSL_PACKAGE = '@dhara/dsl' as const;

/** Semver of the DSL grammar this build understands (doc 06 §8). */
export const DSL_GRAMMAR_VERSION = '0.1.0' as const;
