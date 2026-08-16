// packages/db is the data layer, and the one place a raw Prisma client may exist. The root
// config bans `@prisma/client` imports everywhere so the tenant-scoped client cannot be
// routed around (ADR-011); here that ban would forbid the layer from doing its job.
//
// This override lives in its own file rather than as a `files:` block in the root config
// because each package runs ESLint from its own directory, so root-relative path patterns
// like `packages/db/**` never match.
import root from '../../eslint.config.mjs';

export default [...root, { rules: { 'no-restricted-imports': 'off' } }];
