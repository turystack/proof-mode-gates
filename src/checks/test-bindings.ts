import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

// turystack-proof:pattern-data — the tags below are the names of required tests, not tests.

/**
 * The hole under the `test:` class.
 *
 * A law bound to `test:` is proved by a test in the project's own suite, and
 * the ladder's test rung runs that suite. But nothing anywhere checked that the
 * test *exists*. A project with no test for `denial-visible` runs a green suite
 * and reports the law as covered by the `test:` binding — which is the same
 * defect as `passWithNoTests`, one level up: a rung reporting on nothing.
 *
 * So a `test:` binding is satisfied here by a test that names it. The tag is
 * written into the test's title:
 *
 *     it('denies without leaking existence @denial-visible', () => { … })
 *
 * A tag rather than a filename because the test that proves a law is not always
 * where you would guess, and a convention about names is a convention people
 * break silently.
 *
 * Applicability is per project. Requiring `axe-clean` of a service with no
 * screens would produce a finding nobody can act on, and a gate that cries wolf
 * is a gate that gets bypassed — which `DLV-9` then has to catch. So each
 * binding declares when it applies, and reports `skipped` when it does not.
 */

type Binding = {
	applies(context: CheckContext): boolean
	rules: string[]
	tag: string
	why: string
}

const has = (context: CheckContext, pattern: RegExp) =>
	context.files.some((f) => pattern.test(f))

const frontend = (context: CheckContext) => has(context, /\.tsx$/)
const backend = (context: CheckContext) =>
	has(context, /\.(?:controller|use-case|handler)\.ts$/)

export const BINDINGS: Binding[] = [
	{
		applies: frontend,
		rules: [
			'AXS-6',
			'FE-AXS-1',
		],
		tag: 'axe-clean',
		why: 'an accessibility regression is invisible to everyone who is not affected by it, which is most of the people reviewing',
	},
	{
		applies: (context) =>
			has(context, /(?:^|\/)components\/[^/]+\/[^/]+\.tsx$/),
		rules: [
			'PROP-6',
			'TST-2',
		],
		tag: 'compound-state',
		why: 'a compound component whose parts fall out of sync renders a state no story shows',
	},
	{
		applies: (context) => frontend(context) || backend(context),
		rules: [
			'ARC-ERR-9',
		],
		tag: 'denial-visible',
		why: 'a denial that renders as an empty screen is indistinguishable from an empty result, and the user retries forever',
	},
	{
		applies: (context) => has(context, /\.(?:handler|subscriber)\.ts$/),
		rules: [
			'ARC-IDP-1',
		],
		tag: 'duplicate-delivery',
		why: 'delivery is at-least-once, so the second delivery is not an edge case — it is Tuesday',
	},
	{
		applies: (context) => frontend(context) || backend(context),
		rules: [
			'ARC-ERR-8',
		],
		tag: 'five-outcomes',
		why: 'loading, empty, error, denied and success are five states, and the one nobody tested is the one nobody built',
	},
	{
		applies: (context) => has(context, /\.(?:handler|subscriber)\.ts$/),
		rules: [
			'ARC-IDP-3',
		],
		tag: 'out-of-order',
		why: 'brokers reorder, so a handler that assumes sequence is a handler that corrupts state on a retry',
	},
	{
		applies: (context) =>
			has(context, /(?:^|\/)components\/[^/]+\/[^/]+\.tsx$/),
		rules: [
			'AXS-2',
		],
		tag: 'state-exposed',
		why: 'a control whose state is only visual is a control assistive technology cannot report',
	},
	{
		applies: (context) => has(context, /upload/i),
		rules: [
			'UPL-6',
		],
		tag: 'upload-states',
		why: 'an upload has more failure states than any other interaction on the page, and each one needs a decided screen',
	},
]

// `tag`, not `id`: the root validator greps this directory for `id: '…'` to
// count implemented gates, and these are `test:` bindings, not gates. Naming
// the field `id` inflated the coverage number by eight — which the registry's
// own discoverability test caught, and which is the exact direction of error
// this whole system is built to refuse.
const TAG = (tag: string) => new RegExp(`@${tag}\\b`)

export const testBindings: Check = {
	id: 'test-bindings',
	rules: BINDINGS.flatMap((binding) => binding.rules),
	async run(context: CheckContext) {
		const tests = context.files.filter((file) =>
			/\.(?:test|spec)\.tsx?$/.test(file),
		)
		const applicable = BINDINGS.filter((binding) => binding.applies(context))

		if (applicable.length === 0) {
			return {
				id: 'test-bindings',
				state: 'skipped',
				summary: 'no surface here that a test: binding applies to',
				violations: [],
			}
		}

		const titles: string[] = []

		for (const file of tests) {
			titles.push(await context.read(file))
		}

		const suite = titles.join('\n')
		const violations: Violation[] = applicable
			.filter((binding) => !TAG(binding.tag).test(suite))
			.map((binding) => ({
				file: tests[0] ?? '.',
				message: `no test tagged @${binding.tag} — ${binding.why}`,
				rule: binding.rules[0],
			}))

		return conclude(
			'test-bindings',
			violations,
			applicable.length,
			'applicable test: binding(s)',
		)
	},
}
