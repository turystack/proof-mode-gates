#!/usr/bin/env node

/**
 * Rewrite the `@/…` import alias into relative paths, in the build output.
 *
 * TypeScript resolves `paths` when it type-checks and then emits the specifier
 * unchanged, so `dist/cli.js` ships an import of `@/report.js` that Node cannot
 * resolve. The package builds, and the binary fails on its first line.
 *
 * This was previously delegated to `tsc-alias`, which is declared in
 * `package.json` and is not installed — `gates` shares `cli`'s `node_modules`
 * through a symlink, and that tree does not have it. So `pnpm build` failed and
 * `turystack-proof` did not run at all, which is a strange thing to discover
 * about the package whose entire job is running gates.
 *
 * Doing it here removes the dependency instead of adding the install. The
 * mapping is one alias onto one directory, `dist` mirrors `src`, and thirty
 * lines that this repository controls are easier to trust than a build step that
 * silently was not there.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'

const DIST = resolve(import.meta.dirname, '..', 'dist')
const ALIAS = /(from\s+|import\s*\(\s*|require\s*\(\s*)(['"])@\/([^'"]+)\2/g

function walk(directory) {
	const files = []

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)

		if (entry.isDirectory()) {
			files.push(...walk(path))
		} else if (/\.(?:js|cjs|mjs|d\.ts)$/.test(entry.name)) {
			files.push(path)
		}
	}

	return files
}

let rewritten = 0

for (const file of walk(DIST)) {
	const source = readFileSync(file, 'utf8')

	const next = source.replace(ALIAS, (_match, keyword, quote, target) => {
		const to = relative(dirname(file), join(DIST, target))

		return `${keyword}${quote}${to.startsWith('.') ? to : `./${to}`}${quote}`
	})

	if (next !== source) {
		writeFileSync(file, next, 'utf8')
		rewritten += 1
	}
}

process.stdout.write(`✓ resolved @/ aliases in ${rewritten} emitted file(s)\n`)
