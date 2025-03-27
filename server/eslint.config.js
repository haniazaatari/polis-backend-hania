import js from '@eslint/js';
import sonarjs from 'eslint-plugin-sonarjs';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node
    },
    plugins: {
      js,
      sonarjs
    },
    extends: ['js/recommended'],
    rules: {
      'no-unused-vars': 'off',
      'sonarjs/cognitive-complexity': ['error', 15]
    }
  }
]);
