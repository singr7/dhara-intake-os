// Flat ESLint config shared by every workspace package.
// Packages invoke it explicitly: `eslint --config ../../eslint.config.js src`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',

      // --- Module boundary rules (doc 04 §3) ---------------------------------
      // The tenant-scoped client is only a guarantee if there is no way around it, so the
      // rule is not "prefer @dhara/db" — it is that `@prisma/client` does not resolve
      // anywhere else. `packages/db` re-exports the model types and enums that callers
      // legitimately need (ADR-011).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message:
                'Import from @dhara/db instead. The raw client bypasses tenant scoping and ' +
                'the append-only guards (ADR-010, ADR-011); if you genuinely need it, use ' +
                'the platformOps namespace and say why in review.',
            },
          ],
        },
      ],

      // Zones are filled in as modules land (workflow in S03, session in S04).
      // Cross-module imports must go through each module's index.ts.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './apps/runner/src',
              from: './apps/api/src',
              message:
                'Runner must not import API internals — share types via @dhara/contracts only.',
            },
            {
              target: './apps/console/app',
              from: './apps/api/src',
              message:
                'Console must not import API internals — share types via @dhara/contracts only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
