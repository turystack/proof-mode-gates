import type { CheckResult, Violation } from '@/types.js'

/**
 * The one place a structural check turns findings into a state.
 *
 * Two rules, and both exist because the failure mode of a gate is always the
 * same — reporting green about nothing:
 *
 * - `inspected === 0` is **`skipped`**, never `pass`. A check that found no
 *   controllers has not proved the controllers are fine; it has proved it was
 *   pointed somewhere without controllers, and the report should say so.
 * - a check whose finding is a missing declaration rather than a wrong one
 *   still fails. Absence is the defect in most of these laws.
 */
export function conclude(
	id: string,
	violations: Violation[],
	inspected: number,
	unit: string,
	aside = '',
): CheckResult {
	if (inspected === 0) {
		return {
			id,
			state: 'skipped',
			summary: `no ${unit} to inspect${aside}`,
			violations: [],
		}
	}

	return {
		id,
		state: violations.length > 0 ? 'fail' : 'pass',
		summary:
			violations.length > 0
				? `${violations.length} finding(s) across ${inspected} ${unit}${aside}`
				: `${inspected} ${unit} inspected${aside}`,
		violations,
	}
}

/** 1-indexed line of an offset, for a violation that can point at one. */
export function lineOf(source: string, index: number): number {
	return source.slice(0, index).split('\n').length
}

/** The line a pattern first appears on, or undefined when it does not. */
export function lineMatching(
	source: string,
	pattern: RegExp,
): number | undefined {
	const match = pattern.exec(source)

	return match ? lineOf(source, match.index) : undefined
}
