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
      // S01 placeholder: zones are filled in as modules land (auth/tenancy in S02,
      // workflow in S03, session in S04). Cross-module imports must go through each
      // module's index.ts; raw Prisma access outside packages/db + platform-ops is
      // a review-blocking error (rule tightened in S02).
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
