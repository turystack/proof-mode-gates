import type { Check, CheckContext, Violation } from '@/types.js'

/**
 * `ARC-CTR-4` — a generated artifact is never edited by hand.
 *
 * The check is on the **diff**, not on the file's content: a generated file is
 * allowed to change, it is just not allowed to change by hand. Anything under a
 * generated path that appears in the change set without its generator having
 * run is a hand edit that the next generation will silently delete.
 */

const GENERATED = [
	/(^|\/)~sdk\//,
	/(^|\/)routeTree\.gen\.ts$/,
	/\.gen\.ts$/,
	/(^|\/)drizzle\//,
]

export function isGenerated(file: string): boolean {
	return GENERATED.some((pattern) => pattern.test(file))
}

export const generatedUntouched: Check = {
	id: 'generated-untouched',
	rules: [
		'ARC-CTR-4',
		'RTE-2',
		'API-2',
	],
	run(context: CheckContext) {
		const touched = context.changed.filter(isGenerated)
		const violations: Violation[] = touched.map((file) => ({
			file,
			message:
				'generated artifact changed in this task — regenerate it instead of editing it, or the next generation reverts the edit',
			rule: 'ARC-CTR-4',
		}))

		// An empty change set is not a clean one. It is usually a baseline that
		// did not resolve — no git, a missing ref — and reporting `pass` there is
		// this check answering a question it was never asked.
		if (context.changed.length === 0) {
			return {
				id: 'generated-untouched',
				state: 'skipped',
				summary:
					'the change set is empty — nothing to compare against the baseline',
				violations: [],
			}
		}

		return {
			id: 'generated-untouched',
			state: violations.length > 0 ? 'fail' : 'pass',
			summary:
				violations.length > 0
					? `${violations.length} generated file(s) in the change set`
					: `${context.changed.length} changed file(s), no generated artifact hand-edited`,
			violations,
		}
	},
}
