import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

// The core (indexer, render, topk) must run in plain Node tests, so it may not import obsidian.
const CORE_DIRS = ['src/indexer/**/*.ts', 'src/render/**/*.ts', 'src/topk/**/*.ts'];

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig*.json',
		'src/topk/gen/**',
		'vendor/**',
		'tests/fixtures/**',
		'.obsidian-cache/**',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				project: ['./tsconfig.node.json', './tests/e2e/tsconfig.json'],
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
		},
	},
	{
		files: CORE_DIRS,
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{ name: 'obsidian', message: 'Core modules must not depend on obsidian.' },
					],
				},
			],
		},
	},
	{
		files: [
			'tests/**/*.ts',
			'scripts/**/*.ts',
			'bench/**/*.ts',
			'vitest.config.ts',
			'wdio.conf.mts',
		],
		languageOptions: { globals: { ...globals.node, ...globals.mocha } },
		rules: {
			'obsidianmd/rule-custom-message': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'import/no-extraneous-dependencies': 'off',
			'no-console': 'off',
			'no-undef': 'off',
		},
	},
);
