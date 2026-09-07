import type { Rung } from '@/types.js'

/**
 * The eight rungs, in the order `turystack-proof-mode` › `04-gates.md` defines.
 *
 * The order is not taste: each rung is cheaper than the next and, when it
 * fails, makes the ones below it meaningless. Running everything regardless
 * produces a wall of failures whose only real cause is the first one.
 */
export const LADDER: Rung[] = [
	{
		command: 'biome format --write . && git diff --exit-code',
		id: 'format',
		name: 'Format',
		proves: 'the gate is reading code someone formatted',
	},
	{
		command: 'biome check .',
		id: 'lint',
		name: 'Lint',
		proves: 'layer direction, the stack lints, the GritQL rules',
	},
	{
		command: 'tsc --noEmit',
		id: 'typecheck',
		name: 'Typecheck',
		proves: 'the contract holds at the type level',
	},
	{
		command: 'turystack-proof structure',
		id: 'structure',
		name: 'Structure',
		proves: 'placement, barrels, route shape, generated artifacts untouched',
	},
	{
		command: 'vitest run',
		id: 'test',
		name: 'Unit + integration',
		proves: 'behavior, at unit and integration level',
	},
	{
		command: 'vitest run --coverage',
		id: 'coverage',
		name: 'Coverage',
		proves: 'both floors: the codebase, and the lines this task changed',
	},
	{
		command: 'vitest run --config vitest.e2e.config.ts',
		id: 'e2e',
		name: 'End to end',
		proves: 'the wiring, against real infrastructure',
	},
	{
		command: 'playwright test --grep @evidence',
		id: 'visual',
		name: 'Visual evidence',
		proves: 'the screens exist, in every required state',
	},
]

/** A rung that is red makes every rung below it meaningless, so they are skipped. */
export function shortCircuit<
	T extends {
		state: string
	},
>(
	results: T[],
): {
	results: T[]
	stoppedAt?: string
} {
	const index = results.findIndex((result) => result.state === 'fail')

	if (index === -1) {
		return {
			results,
		}
	}

	return {
		results: results.slice(0, index + 1),
		stoppedAt: LADDER[index]?.id,
	}
}
