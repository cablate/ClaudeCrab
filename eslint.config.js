import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'warn',
      'no-console': 'warn',
      'prefer-const': 'warn',
      'no-var': 'error',
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@anthropic-ai/claude-agent-sdk',
          message: 'Import Claude Agent SDK only through src/core/sdk/index.ts.',
        }],
      }],
    },
  },
  {
    files: ['src/core/sdk/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
