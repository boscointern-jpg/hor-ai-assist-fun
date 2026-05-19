import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import importPlugin from 'eslint-plugin-import';
import promise from 'eslint-plugin-promise';

export default [
	js.configs.recommended,
	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: 'module',
				project: './tsconfig.json',
			},
			globals: {
				// Jest/test globals
				describe: 'readonly',
				it: 'readonly',
				expect: 'readonly',
				beforeAll: 'readonly',
				beforeEach: 'readonly',
				afterAll: 'readonly',
				afterEach: 'readonly',
				jest: 'readonly',
				// Node.js globals
				process: 'readonly',
				console: 'readonly',
				Console: 'readonly',
				Buffer: 'readonly',
				global: 'readonly',
				TextEncoder: 'readonly',
				TextDecoder: 'readonly',
				__dirname: 'readonly',
				__filename: 'readonly',
				module: 'readonly',
				require: 'readonly',
				exports: 'writable',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
			security,
			sonarjs,
			import: importPlugin,
			promise,
		},
		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: './tsconfig.json',
				},
			},
		},
		rules: {
			...tseslint.configs.recommended.rules,
			'@typescript-eslint/explicit-function-return-type': 'error',
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_' },
			],
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/strict-boolean-expressions': 'error',
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error',
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/no-unnecessary-type-assertion': 'error',
			'@typescript-eslint/prefer-nullish-coalescing': 'error',
			'@typescript-eslint/prefer-optional-chain': 'error',
			'@typescript-eslint/prefer-readonly': 'error',
			'@typescript-eslint/prefer-string-starts-ends-with': 'error',
			'@typescript-eslint/no-unsafe-assignment': 'error',
			'@typescript-eslint/no-unsafe-member-access': 'error',
			'@typescript-eslint/no-unsafe-call': 'error',
			'@typescript-eslint/no-unsafe-return': 'error',
			'import/no-cycle': 'error',
			'import/no-unused-modules': 'error',
			'import/no-unresolved': 'error',
			'import/order': [
				'error',
				{
					groups: [
						'builtin',
						'external',
						'internal',
						'parent',
						'sibling',
						'index',
					],
					'newlines-between': 'always',
					alphabetize: { order: 'asc' },
				},
			],
			'no-console': ['error', { allow: ['warn', 'error'] }],
			'no-debugger': 'error',
			'no-alert': 'error',
			'no-var': 'error',
			'prefer-const': 'error',
			eqeqeq: ['error', 'always'],
			curly: ['error', 'all'],
			'no-throw-literal': 'error',
			'prefer-promise-reject-errors': 'error',
			'no-return-await': 'error',
			'require-await': 'error',
			'no-async-promise-executor': 'error',
			'no-promise-executor-return': 'error',
		},
	},
	{
		ignores: [
			'dist/',
			'coverage/',
			'node_modules/',
			'*.js',
			'esbuild-config.js',
		],
	},
];
