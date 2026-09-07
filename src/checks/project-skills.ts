import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { stripFences } from '@/checks/unfilled.js'

/**
 * The project's own two skills — its spec and its UI/UX rules.
 *
 * These skills are templates until someone fills them, and the whole harness
 * depends on being able to tell the difference. A section that still carries
 * its marker is honest; a section filled with a plausible paragraph nobody
 * decided is the failure mode this file exists to make visible.
 */

const MARKER = '<!-- turystack:unfilled -->'
const SPEC = /^\.(?:claude|codex)\/skills\/[^/]+-spec\/(.+\.md)$/
const UIUX = /^\.(?:claude|codex)\/skills\/[^/]+-uiux\/(.+\.md)$/

function unfilledCheck(spec: {
	id: string
	rule: string
	pattern: RegExp
	skill: string
}): Check {
	const { id, rule, pattern, skill } = spec

	return {
		id,
		rules: [
			rule,
		],
		async run(context: CheckContext) {
			const violations: Violation[] = []
			const sections = context.files.filter((file) => pattern.test(file))

			for (const file of sections) {
				const source = stripFences(await context.read(file))
				const index = source.indexOf(MARKER)

				if (index === -1) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, index),
					message: `still unfilled — the part of the task that depends on it stops and asks, it does not guess`,
					rule,
				})
			}

			return conclude(id, violations, sections.length, `${skill} section(s)`)
		},
	}
}

export const specUnfilled = unfilledCheck({
	id: 'spec-unfilled',
	pattern: SPEC,
	rule: 'SPC-1',
	skill: 'spec',
})

export const uiuxUnfilled = unfilledCheck({
	id: 'uiux-unfilled',
	pattern: UIUX,
	rule: 'UIX-3',
	skill: 'uiux',
})

/**
 * `SPC-5` — a capability states its unhappy paths.
 *
 * The happy path is the one everybody writes down and nobody gets wrong. The
 * four that produce incidents are: not allowed, not found, already done, and
 * blocked by state — and a spec silent about them delegates the decision to
 * whoever implements it, at 5pm.
 */
const UNHAPPY: Array<
	[
		RegExp,
		string,
	]
> = [
	[
		/not allowed|forbidden|denied|sem permiss/i,
		'not allowed',
	],
	[
		/not found|does not exist|inexistente/i,
		'not found',
	],
	[
		/already|idempot|j[áa] (?:foi|est[áa])/i,
		'already done',
	],
	[
		/blocked by state|invalid (?:state|transition)|estado/i,
		'blocked by state',
	],
]

export function missingUnhappyPaths(section: string): string[] {
	return UNHAPPY.filter(([shape]) => !shape.test(section)).map(
		([, name]) => name,
	)
}

export const capabilityUnhappyPaths: Check = {
	id: 'capability-unhappy-paths',
	rules: [
		'SPC-5',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const definitions = context.files.filter(
			(file) => SPEC.test(file) && /01-definition\.md$/.test(file),
		)

		for (const file of definitions) {
			const source = stripFences(await context.read(file))

			if (source.includes(MARKER)) {
				continue
			}

			const missing = missingUnhappyPaths(source)

			if (missing.length === 0) {
				continue
			}

			violations.push({
				file,
				message: `no statement of: ${missing.join(', ')} — a spec silent about an unhappy path delegates the decision to whoever implements it`,
				rule: 'SPC-5',
			})
		}

		return conclude(
			'capability-unhappy-paths',
			violations,
			definitions.length,
			'definition section(s)',
		)
	},
}

/**
 * `SPC-6` — a stateful entity has an explicit transition table.
 *
 * With a table, a transition absent from it is illegal. Without one, it is
 * undefined, and undefined transitions are decided by whichever branch happens
 * to run first.
 */
export const transitionTable: Check = {
	id: 'transition-table',
	rules: [
		'SPC-6',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const domains = context.files.filter(
			(file) => SPEC.test(file) && /02-domains\.md$/.test(file),
		)

		for (const file of domains) {
			const source = stripFences(await context.read(file))

			if (source.includes(MARKER)) {
				continue
			}

			const hasTable = /\|\s*(?:from|de)\s*\|\s*(?:to|para)\s*\|/i.test(source)

			if (hasTable) {
				continue
			}

			violations.push({
				file,
				message:
					'no from → to transition table — without one an absent transition is undefined rather than illegal, and undefined is decided by whichever branch runs first',
				rule: 'SPC-6',
			})
		}

		return conclude(
			'transition-table',
			violations,
			domains.length,
			'domain section(s)',
		)
	},
}

/**
 * `UIX-12` — every surface with a design has an export in `assets/`.
 *
 * The delivery report puts the proposal beside the built screen. With no
 * export, that comparison silently becomes a screenshot next to nothing.
 */
export const designExport: Check = {
	id: 'design-export',
	rules: [
		'UIX-12',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const sections = context.files.filter(
			(file) => UIUX.test(file) && /05-assets\.md$/.test(file),
		)

		for (const file of sections) {
			const source = stripFences(await context.read(file))

			if (source.includes(MARKER)) {
				continue
			}

			const root = file.replace(/05-assets\.md$/, 'assets/')
			const referenced = [
				...source.matchAll(/assets\/([\w.-]+\.(?:png|jpg|jpeg|svg|webp|pdf))/g),
			]

			for (const match of referenced) {
				if (context.files.includes(`${root}${match[1]}`)) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `assets/${match[1]} is named here and absent from the skill — the report's proposal-beside-shipped comparison then puts the screenshot next to nothing`,
					rule: 'UIX-12',
				})
			}
		}

		return conclude(
			'design-export',
			violations,
			sections.length,
			'asset section(s)',
		)
	},
}

/**
 * `UIX-4` — a token is named for its role, never its appearance.
 *
 * `--color-blue` survives exactly until the brand changes, after which the
 * codebase says blue everywhere and renders green.
 */
const APPEARANCE =
	/^--(?:color|bg|border|text)?-?(?:blue|red|green|yellow|orange|purple|pink|grey|gray|white|black|light|dark)(?:-\d{2,3})?$/

export function isAppearanceName(token: string): boolean {
	return APPEARANCE.test(token)
}

export const tokenRoleNames: Check = {
	id: 'token-role-names',
	rules: [
		'UIX-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const brands = context.files.filter(
			(file) => UIUX.test(file) && /01-brand\.md$/.test(file),
		)
		let tokens = 0

		for (const file of brands) {
			const source = await context.read(file)

			for (const match of source.matchAll(/(--[a-z][\w-]*)\s*:/g)) {
				tokens += 1

				if (!isAppearanceName(match[1])) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `${match[1]} is named for how it looks — it survives until the brand changes, after which the codebase says blue everywhere and renders green`,
					rule: 'UIX-4',
				})
			}
		}

		return conclude('token-role-names', violations, tokens, 'token(s)')
	},
}

/**
 * `UIX-5` — every token has a value in both schemes.
 *
 * A token defined for one scheme only does not fall back to something sensible;
 * it falls back to whatever the browser inherits, which is usually the other
 * scheme's text on this scheme's background.
 */
export function tokensByScheme(source: string): {
	dark: Set<string>
	light: Set<string>
} {
	const light = new Set<string>()
	const dark = new Set<string>()
	const darkFrom = source.search(
		/prefers-color-scheme:\s*dark|\[data-theme=['"]dark['"]\]/,
	)

	for (const match of source.matchAll(/(--[a-z][\w-]*)\s*:/g)) {
		const index = match.index ?? 0
		const target = darkFrom !== -1 && index > darkFrom ? dark : light
		target.add(match[1])
	}

	return {
		dark,
		light,
	}
}

export const tokenSchemeParity: Check = {
	id: 'token-scheme-parity',
	rules: [
		'UIX-5',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const brands = context.files.filter(
			(file) => UIUX.test(file) && /01-brand\.md$/.test(file),
		)
		let inspected = 0

		for (const file of brands) {
			const source = await context.read(file)
			const { dark, light } = tokensByScheme(source)

			if (dark.size === 0) {
				continue
			}

			inspected += light.size

			for (const token of light) {
				if (dark.has(token)) {
					continue
				}

				violations.push({
					file,
					message: `${token} has no dark value — it does not fall back to something sensible, it inherits, which is usually the other scheme's text on this scheme's background`,
					rule: 'UIX-5',
				})
			}
		}

		return conclude(
			'token-scheme-parity',
			violations,
			inspected,
			'token(s) with both schemes',
		)
	},
}

/**
 * `SPC-15` / `UIX-16` — a requirement carries an id.
 *
 * The ask arrives as a sentence and has to become something a test can cite.
 * Without ids the same work happens and none of it is checkable: the report can
 * list specs and tests side by side and no machine can say whether the list
 * covers what was asked for. A link needs two ends that hold still, and a
 * sentence is not one.
 */
function requirementIds(spec: {
	id: string
	rule: string
	pattern: RegExp
	section: RegExp
	idShape: RegExp
	what: string
	why: string
}): Check {
	const { id, rule, pattern, section, idShape, what, why } = spec

	return {
		id,
		rules: [
			rule,
		],
		async run(context: CheckContext) {
			const violations: Violation[] = []
			const files = context.files.filter(
				(file) => pattern.test(file) && section.test(file),
			)

			let filled = 0

			for (const file of files) {
				const source = stripFences(await context.read(file))

				if (source.includes(MARKER)) {
					continue
				}

				filled += 1

				if (idShape.test(source)) {
					continue
				}

				violations.push({
					file,
					message: `no ${what} — ${why}`,
					rule,
				})
			}

			return conclude(id, violations, filled, 'filled section(s)')
		},
	}
}

export const acceptanceIds = requirementIds({
	id: 'acceptance-ids',
	idShape: /\bAC-\d+\b/,
	pattern: SPEC,
	rule: 'SPC-15',
	section: /01-definition\.md$/,
	what: 'AC-n acceptance criterion',
	why: 'the delivery report cannot say whether what was asked for is what was proved when the spec has nothing to cite',
})

export const designRequirementIds = requirementIds({
	id: 'design-requirement-ids',
	idShape: /\bUX-DR-\d+\b/,
	pattern: UIUX,
	rule: 'UIX-16',
	section: /05-assets\.md$/,
	what: 'UX-DR-n design requirement',
	why: 'a screenshot says what a surface looks like and never what it must do, so two people match the same picture and ship different behaviour',
})

export const PROJECT_SKILL_CHECKS: Check[] = [
	acceptanceIds,
	capabilityUnhappyPaths,
	designRequirementIds,
	designExport,
	specUnfilled,
	tokenRoleNames,
	tokenSchemeParity,
	transitionTable,
	uiuxUnfilled,
]
