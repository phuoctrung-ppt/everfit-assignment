import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.agents/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { project: './tsconfig.json' } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { disallowTypeAnnotations: false },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
    languageOptions: {
      globals: {
        URL: 'readonly',
        require: 'readonly',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
);
