import { describe, expect, it } from 'vitest'

import { clears, diffCoverage, percent } from '@/coverage.js'

describe('two floors, because the total hides the task @coverage-floors', () => {
	it('a healthy total coexists with an untested change', () => {
		const total = {
			covered: 9140,
			label: 'Lines',
			total: 10_000,
		}
		expect(percent(total)).toBeCloseTo(91.4)
		expect(clears(total, 85)).toBe(true)

		const changed = diffCoverage(
			new Map([
				[
					'src/new.ts',
					new Map([
						[
							1,
							0,
						],
						[
							2,
							0,
						],
						[
							3,
							0,
						],
					]),
				],
			]),
			new Map([
				[
					'src/new.ts',
					[
						1,
						2,
						3,
					],
				],
			]),
		)

		expect(percent(changed)).toBe(0)
		expect(clears(changed, 90)).toBe(false)
	})

	it('counts only the lines the task changed', () => {
		const hits = new Map([
			[
				1,
				5,
			],
			[
				2,
				0,
			],
			[
				3,
				9,
			],
			[
				4,
				0,
			],
		])
		const changed = diffCoverage(
			new Map([
				[
					'src/a.ts',
					hits,
				],
			]),
			new Map([
				[
					'src/a.ts',
					[
						1,
						2,
					],
				],
			]),
		)

		expect(changed).toEqual({
			covered: 1,
			label: 'Changed lines',
			total: 2,
		})
	})

	it('an empty change set is vacuously covered, not zero', () => {
		expect(percent(diffCoverage(new Map(), new Map()))).toBe(100)
	})
})
