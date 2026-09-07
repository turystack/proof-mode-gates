import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { aside, scannable } from '@/checks/scope.js'

// turystack-proof:pattern-data — the rule shapes below are the patterns being looked for, not uses of them.

/**
 * Laws that a lint plugin cannot hold, because they depend on *where the file
 * is*.
 *
 * Biome 2.2.2 loads GritQL plugins globally: the object form that accepts an
 * `includes` glob is parsed and then ignored, silently — the same config with
 * `plugins: ["./x.grit"]` reports two diagnostics and with
 * `plugins: [{ path: "./x.grit", includes: [...] }]` reports none, with no
 * error in between. So a rule that means "no `fetch` *outside the client*" or
 * "no branch on a rule *inside the boundary*" cannot be written as a plugin
 * without also firing everywhere the rule permits it.
 *
 * These live here instead, where the path is part of the input. That is not a
 * workaround — the path is genuinely part of these laws.
 */

const isBoundary = (file: string) =>
	/\.(?:controller|handler|subscriber|resolver)\.ts$/.test(file)

const isUseCase = (file: string) => /\.use-case\.ts$/.test(file)

const isClient = (file: string) =>
	/(?:^|\/)(?:sdk|api|http)\//.test(file) || /\.client\.ts$/.test(file)

const isTest = (file: string) => /\.(?:test|spec)\.tsx?$/.test(file)

/**
 * A story is a demo surface. Fetching sample data in one is the story doing its
 * job, not a call site skipping the client, and flagging it is how a real
 * finding gets lost in a list nobody reads.
 */
const isStory = (file: string) => /\.stories\.tsx?$/.test(file)

const isRoute = (file: string) => /(?:^|\/)routes?\/.+\.tsx$/.test(file)

/**
 * `API-1` / `FRM-6` — every call goes through the configured SDK client.
 *
 * The client is where the base URL, the auth header, the error envelope and the
 * retry policy live. A `fetch` at the call site has none of them, and it works
 * — until the session expires, or the envelope changes, or the endpoint moves.
 */
export const noFetchOutsideClient: Check = {
	id: 'no-fetch-outside-client',
	rules: [
		'API-1',
		'FRM-6',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files } = await scannable(
			context,
			(file) =>
				/\.(?:ts|tsx)$/.test(file) &&
				!isClient(file) &&
				!isTest(file) &&
				!isStory(file),
		)

		for (const file of files) {
			const source = await context.read(file)

			for (const match of source.matchAll(
				/\b(?:fetch|axios)\s*(?:\.\w+)?\(/g,
			)) {
				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message:
						'calls the network directly — the client holds the base URL, the auth header, the error envelope and the retry policy, and this call has none of them',
					rule: 'API-1',
				})
			}
		}

		return conclude(
			'no-fetch-outside-client',
			violations,
			files.length,
			'call-site file(s)',
			aside(excluded),
		)
	},
}

/**
 * `ARC-DEL-1` — the delivery boundary translates, validates and delegates.
 *
 * A rule that lives in the controller is a rule the background handler does not
 * have, which is how the same operation behaves differently depending on
 * whether a person or a queue asked for it.
 */
const RULE_SHAPE =
	/\bif\s*\([^)]*\b(?:status|state|balance|total|quantity|role|plan|tier|limit)\b[^)]*[<>=!]/

export const noRuleInBoundary: Check = {
	id: 'no-rule-in-boundary',
	rules: [
		'ARC-DEL-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const boundaries = context.files.filter(isBoundary)

		for (const file of boundaries) {
			const source = await context.read(file)
			const match = RULE_SHAPE.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'branches on domain state — a rule here is a rule the queue path does not have, so the same operation behaves differently depending on who asked',
				rule: 'ARC-DEL-1',
			})
		}

		return conclude(
			'no-rule-in-boundary',
			violations,
			boundaries.length,
			'boundary file(s)',
		)
	},
}

/**
 * `UC-4` — a business rule is protected by the entity, not by an `if` in the
 * use case.
 *
 * Copied into the use case it holds for that one path. The entity is the only
 * place that holds for every path, including the ones written next year.
 */
export const noRuleInUseCase: Check = {
	id: 'no-rule-in-use-case',
	rules: [
		'UC-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const useCases = context.files.filter(isUseCase)

		for (const file of useCases) {
			const source = await context.read(file)
			const match = RULE_SHAPE.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'the rule is an `if` here — move it to an entity guard, which is the only place that holds for every path, including the ones written next year',
				rule: 'UC-4',
			})
		}

		return conclude(
			'no-rule-in-use-case',
			violations,
			useCases.length,
			'use case(s)',
		)
	},
}

/**
 * `ARC-TST-3` — test data comes from a factory derived from the contract.
 *
 * A hand-written literal is a copy of the shape at the moment it was typed. The
 * contract gains a required field, the factory fails to compile everywhere at
 * once, and the literal keeps passing while testing a shape that no longer
 * exists.
 */
export function handWrittenFixtures(source: string): number {
	return [
		...source.matchAll(
			/(?:const|let)\s+\w*(?:[Ff]ixture|[Mm]ock|[Ss]tub)\w*\s*(?::[^=]+)?=\s*\{/g,
		),
	].length
}

export const noLiteralFixture: Check = {
	id: 'no-literal-fixture',
	rules: [
		'ARC-TST-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files: tests } = await scannable(context, isTest)

		for (const file of tests) {
			const source = await context.read(file)
			const count = handWrittenFixtures(source)

			if (count === 0) {
				continue
			}

			violations.push({
				file,
				message: `${count} hand-written fixture object(s) — a literal is a copy of the shape at the moment it was typed, and it keeps passing after the contract moves`,
				rule: 'ARC-TST-3',
			})
		}

		return conclude(
			'no-literal-fixture',
			violations,
			tests.length,
			'test file(s)',
			aside(excluded),
		)
	},
}

/**
 * `COM-5` / `USO-2` — a wrapper derives its props from the primitive.
 *
 * Retyped by hand, the wrapper's contract is a snapshot. The primitive adds a
 * prop and the wrapper cannot pass it; the primitive removes one and the
 * wrapper still advertises it.
 */
export const noParallelContract: Check = {
	id: 'no-parallel-contract',
	rules: [
		'COM-5',
		'USO-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const wrappers = context.files.filter(
			(file) => /\.tsx$/.test(file) && !isTest(file),
		)
		let inspected = 0

		for (const file of wrappers) {
			const source = await context.read(file)
			const imports = /from '@turystack\/react-web'/.test(source)

			if (!imports) {
				continue
			}

			inspected += 1

			const declaresOwn = /(?:type|interface)\s+\w*Props\s*(?:=|\{)/.exec(
				source,
			)
			const derives = /\bOmit<|\bPick<|\bComponentProps(?:WithRef)?</.test(
				source,
			)

			if (!declaresOwn || derives) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, declaresOwn.index),
				message:
					'declares its own props beside a primitive it wraps — a retyped contract is a snapshot, so the primitive gains a prop this wrapper cannot pass',
				rule: 'COM-5',
			})
		}

		return conclude('no-parallel-contract', violations, inspected, 'wrapper(s)')
	},
}

/**
 * `COM-8` — a destructive confirmation composes the shared `Confirm`.
 *
 * Reassembled from a dialog, a title and two buttons, it is a confirmation that
 * looks right and misses whatever the shared one learned: the focus trap, the
 * destructive tone, the impact list, the disabled state while the write runs.
 */
export const noReassembledConfirm: Check = {
	id: 'no-reassembled-confirm',
	rules: [
		'COM-8',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter(
			(file) =>
				/\.tsx$/.test(file) &&
				!isTest(file) &&
				!isStory(file) &&
				// The file that *is* the shared Confirm cannot compose the shared
				// Confirm. Flagging it made the fix for this law read as a
				// violation of it.
				!/(?:^|\/)components\/confirm\//.test(file),
		)
		let candidates = 0

		for (const file of files) {
			const source = await context.read(file)
			const destructive =
				/\b(?:delete|remove|cancel|destroy|revoke|excluir|cancelar)\b/i.test(
					source,
				)
			const usesDialog = /<(?:Dialog|AlertDialog|Modal)\b/.test(source)

			if (!destructive || !usesDialog) {
				continue
			}

			candidates += 1

			if (/<Confirm\b|\bConfirm\b\s*from/.test(source)) {
				continue
			}

			violations.push({
				file,
				message:
					'assembles its own destructive confirmation — the shared Confirm carries the focus trap, the tone, the impact list and the pending state this one has to rediscover',
				rule: 'COM-8',
			})
		}

		return conclude(
			'no-reassembled-confirm',
			violations,
			candidates,
			'destructive dialog(s)',
		)
	},
}

/**
 * `RTE-L1` — a route exports `Route` by name.
 *
 * A default export cannot be found by grep, cannot be re-exported without
 * renaming, and makes every route file's public shape a matter of how it was
 * imported.
 */
export const noDefaultExportRoute: Check = {
	id: 'no-default-export-route',
	rules: [
		'RTE-L1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const routes = context.files.filter(isRoute)

		for (const file of routes) {
			const source = await context.read(file)
			const match = /^export default\b/m.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'default-exports the route — export `Route` by name, so it can be found by grep and re-exported without being renamed',
				rule: 'RTE-L1',
			})
		}

		return conclude(
			'no-default-export-route',
			violations,
			routes.length,
			'route(s)',
		)
	},
}

export const SCOPED_CHECKS: Check[] = [
	noDefaultExportRoute,
	noFetchOutsideClient,
	noLiteralFixture,
	noParallelContract,
	noReassembledConfirm,
	noRuleInBoundary,
	noRuleInUseCase,
]
