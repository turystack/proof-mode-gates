import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `ARC-ERR-1` — the error catalogue is one per product, never one per module.
 *
 * A catalogue per module is how two modules end up with the same code meaning
 * different things, and how a consumer discovers that only in production. The
 * shape is checkable: exactly one file builds the catalogue, and no module
 * ships its own.
 */

const BUILDER = /createExceptions\s*\(/
const PER_MODULE = /(^|\/)[\w-]+\.exceptions\.ts$/

export const oneCatalogue: Check = {
	id: 'one-catalogue',
	rules: [
		'ARC-ERR-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const candidates = context.files.filter(
			(file) => file.endsWith('.ts') && !file.includes('.test.'),
		)

		const builders: string[] = []

		for (const file of candidates) {
			if (PER_MODULE.test(file)) {
				violations.push({
					file,
					message:
						'a catalogue per module — the codes belong to one catalogue for the whole product',
					rule: 'ARC-ERR-1',
				})
				continue
			}

			if (BUILDER.test(await context.read(file))) {
				builders.push(file)
			}
		}

		if (builders.length > 1) {
			for (const file of builders.slice(1)) {
				violations.push({
					file,
					message: `a second catalogue — the first is ${builders[0]}`,
					rule: 'ARC-ERR-1',
				})
			}
		}

		if (candidates.length > 0 && builders.length === 0) {
			// A codebase with source files and no catalogue builder has not been
			// proved compliant — it has been proved to have no catalogue, which is
			// a different sentence and used to be printed as a tick.
			return {
				id: 'one-catalogue',
				state: 'warn',
				summary:
					'no catalogue found — fine while the project raises no domain errors, a finding once it does',
				violations,
			}
		}

		return conclude(
			'one-catalogue',
			violations,
			candidates.length,
			'source file(s)',
		)
	},
}
