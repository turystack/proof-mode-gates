import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { aside, scannable } from '@/checks/scope.js'

// turystack-proof:pattern-data — the BYPASS table below spells out the patterns a bypass takes, so the file matches its own rule.

/**
 * The delivery's checks on itself.
 *
 * These read the report the runner is about to emit, which makes them unusual:
 * most checks inspect the code, these inspect the claim being made about it.
 * That is the point of `DLV-14` — the artifact that says "done" is subject to
 * the same scrutiny as the code it is about.
 */

type Evidence = {
	backend?: {
		specs?: SpecLink[]
	}
	context?: {
		kind: string
		source?: string
		title?: string
	}[]
	frontend?: {
		screens?: Screen[]
		specs?: SpecLink[]
	}
	law?: {
		bindings?: Binding[]
	}
	ladder?: unknown[]
}

type SpecLink = {
	spec: string
	test?: string
	level?: string
	state?: string
}

type Binding = {
	detector?: string
	id: string
	law?: string
	note?: string
	reviewer?: string
	state?: string
}

type Screen = {
	captures?: {
		image?: string | null
		state: string
	}[]
	name?: string
	required?: string[]
}

const REPORT = /(?:^|\/)gate-report\.json$/

async function readReport(
	context: CheckContext,
): Promise<Evidence | undefined> {
	const file = context.files.find((candidate) => REPORT.test(candidate))

	if (!file) {
		return undefined
	}

	try {
		return JSON.parse(await context.read(file)) as Evidence
	} catch {
		return undefined
	}
}

function noReport(id: string) {
	return {
		id,
		state: 'skipped' as const,
		summary:
			'no gate-report.json yet — this check runs on the report the task emits',
		violations: [],
	}
}

/**
 * `DLV-3` — the five inputs are written down, not remembered.
 *
 * The value of recording them is not bureaucratic. Six weeks later, "which
 * version of the spec was this built against" is the first question of every
 * regression, and memory does not answer it.
 */
export const contextRecorded: Check = {
	id: 'context-recorded',
	rules: [
		'DLV-3',
	],
	async run(context: CheckContext) {
		const report = await readReport(context)

		if (!report) {
			return noReport('context-recorded')
		}

		const recorded = report.context ?? []
		const required = [
			'Capability spec',
			'Domain model',
			'Design',
			'UI/UX rules',
			'API contract',
		]

		const violations: Violation[] = required
			.filter(
				(kind) =>
					!recorded.some(
						(entry) => entry.kind === kind && Boolean(entry.source),
					),
			)
			.map((kind) => ({
				file: 'gate-report.json',
				message: `the '${kind}' input has no recorded source — six weeks from now "which version was this built against" has no answer`,
				rule: 'DLV-3',
			}))

		return conclude(
			'context-recorded',
			violations,
			required.length,
			'declared input(s)',
		)
	},
}

/**
 * `DLV-10` — every spec is tied to the test that proves it, in both directions.
 *
 * One direction catches an untested requirement. The other catches a test list
 * padded with things nobody asked for, which is how a coverage number gets
 * respectable without the feature being proven.
 */
export const specTestLink: Check = {
	id: 'spec-test-link',
	rules: [
		'DLV-10',
	],
	async run(context: CheckContext) {
		const report = await readReport(context)

		if (!report) {
			return noReport('spec-test-link')
		}

		// The report keeps specs beside the side that proves them, so both lists
		// are read. Looking for a top-level `specs` — which an earlier version of
		// this check did — found nothing and reported `skipped` on a report full
		// of them.
		const specs = [
			...(report.backend?.specs ?? []),
			...(report.frontend?.specs ?? []),
		]

		const violations: Violation[] = []

		for (const link of specs) {
			if (!link.test) {
				violations.push({
					file: 'gate-report.json',
					message: `"${link.spec}" names no test — a requirement nobody proved is a requirement nobody built`,
					rule: 'DLV-10',
				})
				continue
			}

			if (link.state && link.state !== 'pass') {
				violations.push({
					file: 'gate-report.json',
					message: `"${link.spec}" is proved by a test reporting '${link.state}' — a spec is not covered by a test that does not pass`,
					rule: 'DLV-10',
				})
			}
		}

		return conclude(
			'spec-test-link',
			violations,
			specs.length,
			'spec/test link(s)',
		)
	},
}

/**
 * `DLV-12` — a required capture that is missing fails the delivery.
 *
 * The alternative is what every template does by default: render an empty box
 * where the screenshot would be, and let the reader assume it was an oversight
 * in the tooling rather than a state nobody built.
 */
export const requiredCaptures: Check = {
	id: 'required-captures',
	rules: [
		'DLV-12',
	],
	async run(context: CheckContext) {
		const report = await readReport(context)

		if (!report) {
			return noReport('required-captures')
		}

		const screens = report.frontend?.screens ?? []
		const violations: Violation[] = []

		for (const screen of screens) {
			const captured = new Set(
				(screen.captures ?? [])
					.filter((capture) => capture.image)
					.map((capture) => capture.state),
			)

			for (const state of screen.required ?? []) {
				if (captured.has(state)) {
					continue
				}

				violations.push({
					file: 'gate-report.json',
					message: `${screen.name ?? 'a screen'} has no '${state}' capture — an empty placeholder reads as a tooling gap, not as a state nobody built`,
					rule: 'DLV-12',
				})
			}
		}

		return conclude(
			'required-captures',
			violations,
			screens.length,
			'screen(s)',
		)
	},
}

/**
 * `DLV-13` — a `manual` binding is signed by a person, with a reason.
 *
 * Unsigned, it is indistinguishable from a binding nobody looked at, and the
 * report's automated share becomes a number that flatters itself.
 */
export const manualSigned: Check = {
	id: 'manual-signed',
	rules: [
		'DLV-13',
	],
	async run(context: CheckContext) {
		const report = await readReport(context)

		if (!report) {
			return noReport('manual-signed')
		}

		// `law.bindings`, not `laws`: this check read a key the report never had
		// and reported `skipped` on a report carrying eight manual bindings —
		// the exact "green about nothing" it exists to prevent.
		const manual = (report.law?.bindings ?? []).filter(
			(binding) => binding.detector === 'manual',
		)

		const violations: Violation[] = []

		for (const binding of manual) {
			const who = binding.reviewer
			const why = binding.note

			if (who && why) {
				continue
			}

			violations.push({
				file: 'gate-report.json',
				message: `${binding.id} is ${who ? 'signed with no reason' : 'unsigned'} — a manual binding with no name and no reason is indistinguishable from one nobody looked at`,
				rule: 'DLV-13',
			})
		}

		return conclude(
			'manual-signed',
			violations,
			manual.length,
			'manual binding(s)',
		)
	},
}

/**
 * `DLV-14` — the report exists, and its verdict is computed.
 *
 * A payload carrying a hand-written `"verdict"` is the exact failure this law
 * names: a delivery declaring itself green.
 */
export const reportEmitted: Check = {
	id: 'report-emitted',
	rules: [
		'DLV-14',
	],
	async run(context: CheckContext) {
		const file = context.files.find((candidate) => REPORT.test(candidate))

		if (!file) {
			return {
				id: 'report-emitted',
				state: 'skipped',
				summary: 'the report is written at the end of the run',
				violations: [],
			}
		}

		const source = await context.read(file)
		const violations: Violation[] = []

		if (!/"schema"\s*:\s*"turystack\.gate-report\/1"/.test(source)) {
			violations.push({
				file,
				message:
					'not a turystack.gate-report/1 payload — the renderer computes nothing it cannot read',
				rule: 'DLV-14',
			})
		}

		if (!/"ladder"\s*:\s*\[/.test(source)) {
			violations.push({
				file,
				message:
					'carries no ladder — a verdict with no rungs behind it is an assertion',
				rule: 'DLV-14',
			})
		}

		return conclude('report-emitted', violations, 1, 'report')
	},
}

/**
 * `DLV-9` — no rung is bypassed to unblock.
 *
 * A bypass is invisible three weeks later, when the rule it silenced is the one
 * that would have caught the incident. The check counts them rather than
 * failing on the first: the number is the interesting part.
 */
/**
 * A suppression *opens* its comment — `// biome-ignore …` — and a flag that
 * disables a gate appears in a command, not in a sentence.
 *
 * Written loosely, these matched their own explanations: the CLI's project
 * templates carry a comment saying the `--passWithNoTests` flag is deliberately
 * absent, and this check read that as a bypass. Prose *about* a bypass is the
 * opposite of one, and flagging it teaches people the gate cannot tell.
 */
const OPENS_COMMENT = /^\s*(?:\/\/|\/\*|\*|#)\s*/

const BYPASS: Array<
	[
		RegExp,
		string,
	]
> = [
	[
		/^\s*(?:\/\/|\/\*|\*|#)\s*biome-ignore\b/,
		'a biome-ignore',
	],
	[
		/^\s*(?:\/\/|\/\*|\*|#)\s*eslint-disable\b/,
		'an eslint-disable',
	],
	[
		/^\s*(?:\/\/|\/\*|\*|#)\s*@ts-(?:ignore|nocheck)\b/,
		'a suppressed type error',
	],
	[
		/\bit\.skip\(|\bdescribe\.skip\(|\btest\.skip\(/,
		'a skipped test',
	],
	[
		/--no-verify\b/,
		'a --no-verify',
	],
	[
		/--passWithNoTests\b/,
		'a suite allowed to pass empty',
	],
]

export function bypassIn(line: string): string | undefined {
	const inComment = OPENS_COMMENT.test(line)

	for (const [shape, what] of BYPASS) {
		if (!shape.test(line)) {
			continue
		}

		// A flag named inside a comment is documentation of the flag, not a use
		// of it. `RegExp.source` carries no delimiters, so this asks the pattern
		// itself whether it is a flag.
		if (inComment && shape.source.startsWith('--')) {
			continue
		}

		return what
	}

	return undefined
}

export const noBypass: Check = {
	id: 'no-bypass',
	rules: [
		'DLV-9',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const changed = new Set(context.changed)
		const { excluded, files } = await scannable(
			context,
			(file) =>
				/\.(?:ts|tsx|json|ya?ml|mjs|cjs)$/.test(file) &&
				(changed.size === 0 || changed.has(file)),
		)

		for (const file of files) {
			const source = await context.read(file)

			for (const [index, line] of source.split('\n').entries()) {
				const what = bypassIn(line)

				if (!what) {
					continue
				}

				violations.push({
					file,
					line: index + 1,
					message: `${what} — fix the rule with a fixture proving both sides, or change the law; a bypass is invisible three weeks later`,
					rule: 'DLV-9',
				})
			}
		}

		return conclude(
			'no-bypass',
			violations,
			files.length,
			'file(s)',
			aside(excluded),
		)
	},
}

/** Exported for the harness: the line a bypass was found on, for a message. */
export { lineOf }

export const DELIVERY_CHECKS: Check[] = [
	contextRecorded,
	manualSigned,
	noBypass,
	reportEmitted,
	requiredCaptures,
	specTestLink,
]
