/**
 * Coverage against two floors.
 *
 * The total answers "is the codebase healthy". The diff answers "is the code
 * this task wrote tested" — and only the second can be failed by the change
 * under review. A codebase at 91% is perfectly compatible with a task that
 * added four hundred uncovered lines: the total moves by fractions.
 */

export type CoverageMetric = {
	covered: number
	label: string
	total: number
}

export type CoverageSummary = {
	branches: CoverageMetric
	functions: CoverageMetric
	lines: CoverageMetric
	statements: CoverageMetric
}

export const DEFAULT_FLOOR = 85
/** Higher on purpose: old code has history and reasons, new code has neither. */
export const DEFAULT_DIFF_FLOOR = 90

export function percent(metric: CoverageMetric): number {
	return metric.total === 0 ? 100 : (metric.covered / metric.total) * 100
}

export function clears(metric: CoverageMetric, floor: number): boolean {
	return percent(metric) >= floor
}

/**
 * Coverage restricted to the lines this task changed, from a v8/istanbul
 * summary plus the changed line numbers per file.
 */
export function diffCoverage(
	perFile: Map<string, Map<number, number>>,
	changedLines: Map<string, number[]>,
): CoverageMetric {
	let covered = 0
	let total = 0

	for (const [file, lines] of changedLines) {
		const hits = perFile.get(file)

		if (!hits) {
			continue
		}

		for (const line of lines) {
			const count = hits.get(line)

			if (count === undefined) {
				continue
			}

			total += 1

			if (count > 0) {
				covered += 1
			}
		}
	}

	return {
		covered,
		label: 'Changed lines',
		total,
	}
}
