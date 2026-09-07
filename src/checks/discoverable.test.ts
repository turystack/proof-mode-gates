import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CHECKS } from '@/checks/registry.js'

/**
 * The root validator counts implemented detectors by grepping this directory,
 * because it is a plain script that cannot import a TypeScript module. That
 * makes it a second reader of the same truth, and a second reader drifts.
 *
 * It already did: the checks moved from one file per check into modules grouped
 * by theme, the validator kept counting files, and the coverage number it
 * printed was wrong for as long as nobody looked. It happened to be wrong in
 * the flattering-to-nobody direction — under-reporting — but a number that can
 * silently be wrong downward can silently be wrong upward.
 *
 * So the shape the validator greps for is asserted here, against the registry
 * it is trying to describe. A check the validator cannot see fails this test,
 * where it is cheap to notice, instead of quietly shrinking a percentage.
 */

const CHECKS_DIR = dirname(fileURLToPath(import.meta.url))

/** Kept identical to the pattern in `scripts/validate-skills.mjs`. */
const ID_DECLARATION = /^\s*id: '([\w-]+)',$/gm

function greppableIds(): Set<string> {
	const ids = new Set<string>()

	for (const file of readdirSync(CHECKS_DIR)) {
		if (!file.endsWith('.ts') || file.includes('.test.')) {
			continue
		}

		const source = readFileSync(join(CHECKS_DIR, file), 'utf8')

		for (const match of source.matchAll(ID_DECLARATION)) {
			ids.add(match[1])
		}
	}

	return ids
}

describe('the root validator can see every check', () => {
	it('declares each id as a literal the validator greps for', () => {
		const visible = greppableIds()
		const invisible = CHECKS.map((check) => check.id).filter(
			(id) => !visible.has(id),
		)

		expect(
			invisible,
			"these are registered but the validator cannot see them — declare the id as a literal `id: '…',` line",
		).toEqual([])
	})

	it('greps nothing that is not registered', () => {
		const registered = new Set(CHECKS.map((check) => check.id))
		const orphans = [
			...greppableIds(),
		].filter((id) => !registered.has(id))

		expect(orphans, 'these would be counted as coverage and never run').toEqual(
			[],
		)
	})
})
