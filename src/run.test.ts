import { describe, expect, it } from 'vitest'

import { LADDER, shortCircuit } from '@/ladder.js'
import { RUNG_SCRIPTS, resolveScript } from '@/run.js'

describe('the ladder maps to scripts by convention', () => {
	it('finds the first script a rung prefers', () => {
		expect(
			resolveScript('lint', {
				check: 'biome check .',
			}),
		).toBe('check')
		expect(
			resolveScript('lint', {
				lint: 'biome lint .',
			}),
		).toBe('lint')
		expect(
			resolveScript('lint', {
				check: 'a',
				lint: 'b',
			}),
		).toBe('check')
	})

	it('resolves nothing when the project has no such script', () => {
		expect(resolveScript('e2e', {})).toBeUndefined()
		expect(
			resolveScript('visual', {
				test: 'vitest run',
			}),
		).toBeUndefined()
	})

	it('covers every rung except structure, which the runner owns', () => {
		for (const rung of LADDER) {
			const candidates = RUNG_SCRIPTS[rung.id]

			expect(candidates, `no mapping for rung '${rung.id}'`).toBeDefined()

			if (rung.id !== 'structure') {
				expect(
					candidates.length,
					`rung '${rung.id}' maps to no script`,
				).toBeGreaterThan(0)
			}
		}
	})

	it('keeps the ladder order the skill defines', () => {
		expect(LADDER.map((rung) => rung.id)).toEqual([
			'format',
			'lint',
			'typecheck',
			'structure',
			'test',
			'coverage',
			'e2e',
			'visual',
		])
	})
})

/**
 * `DLV-8` — the ladder stops at the first red rung.
 *
 * Order alone does not satisfy the law. A runner that goes red on typecheck and
 * still reports coverage is reporting a number about code that does not
 * compile, which is exactly the reading the law forbids.
 */
describe('DLV-8 · a red rung ends the run @ladder-order', () => {
	const ladder = (...states: string[]) =>
		states.map((state) => ({
			state,
		}))

	it('reports every rung when nothing is red', () => {
		const { results, stoppedAt } = shortCircuit(ladder('pass', 'pass', 'pass'))

		expect(results).toHaveLength(3)
		expect(stoppedAt).toBeUndefined()
	})

	it('keeps the red rung and drops the ones below it', () => {
		const { results, stoppedAt } = shortCircuit(
			ladder('pass', 'pass', 'fail', 'pass', 'pass'),
		)

		expect(results.map((rung) => rung.state)).toEqual([
			'pass',
			'pass',
			'fail',
		])
		expect(stoppedAt).toBe('typecheck')
	})

	it('never reports a rung below the one that failed first', () => {
		const { results } = shortCircuit(ladder('fail', 'fail'))

		expect(results).toHaveLength(1)
	})
})
