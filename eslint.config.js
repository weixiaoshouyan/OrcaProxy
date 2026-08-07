// ============================================================
// eslint.config.js (flat config, ESLint 9+)
// Lints apps/server TypeScript. The frontend has its own config
// at apps/ui/eslint.config.js.
// ============================================================

const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // CJS project: dynamic require() for lazy/conditional loading is idiomatic.
      '@typescript-eslint/no-require-imports': 'off',
      // The codebase predates strict typing; strict TS + tsc already gate types.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-duplicate-imports': 'warn',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'apps/ui/**',
      'resources/public/**',
      '**/tests/**',
    ],
  },
];
