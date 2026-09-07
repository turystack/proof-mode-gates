import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'

/**
 * What a primitive owes the people who consume it.
 *
 * A primitive is used by screens its author will never see, so every law here
 * is about making the component's behaviour *legible from the outside*: the
 * props that pair, the defaults that exist, the accessible name, the motion the
 * user asked not to see.
 */

const isPrimitive = (file: string) =>
	/(?:^|\/)components\/[^/]+\/[^/]+\.tsx$/.test(file) &&
	!/\.(?:test|stories|styles|context|types)\.tsx?$/.test(file)

/**
 * `PROP-4` — a controlled prop comes with its change callback.
 *
 * A state prop without its handler is a component that looks controllable and
 * is read-only, and the consumer finds out by clicking it.
 *
 * `value` is deliberately absent from the list below.
 *
 * It is the most common controlled prop and also the most common *display*
 * prop: a progress bar declares `value` and nothing changes it, because nothing
 * is supposed to. Nothing in the file separates the two, so a check that
 * required a handler for every `value` would fire on every meter, gauge and
 * progress in the library — thirty-odd findings whose only lesson is that the
 * gate is wrong.
 *
 * So the check keeps what it can prove. `checked`, `open` and `selected` name
 * state a user changes; there is no read-only reading of them. `PROP-4`'s
 * `value` case stays with review, which is the honest place for a distinction a
 * machine cannot draw.
 */
export function controlledPairsMissing(source: string): string[] {
	const pairs: Array<
		[
			string,
			string[],
		]
	> = [
		[
			'checked',
			[
				'onCheckedChange',
				'onCheck',
			],
		],
		[
			'open',
			[
				'onOpenChange',
				'onToggle',
				'onClose',
				'onDismiss',
			],
		],
		[
			'selected',
			[
				'onSelectedChange',
				'onSelectionChange',
				'onSelect',
				'onDateChange',
			],
		],
	]

	return pairs
		.filter(([state, handlers]) => {
			const declaresState = new RegExp(`\\b${state}\\??:`).test(source)
			const setter = `set${state[0].toUpperCase()}${state.slice(1)}`
			const declaresHandler =
				handlers.some((handler) =>
					new RegExp(`\\b${handler}\\??:`).test(source),
				) ||
				new RegExp(`\\b${setter}\\??:`).test(source) ||
				/\bonChange\??:/.test(source)

			return declaresState && !declaresHandler
		})
		.map(([state]) => state)
}

export const controlledPair: Check = {
	id: 'controlled-pair',
	rules: [
		'PROP-6',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		// `.types.ts` only. Scanning the component file too meant reading its
		// internal context types as if they were the published contract — a
		// provider's `{ open, setOpen }` is not a prop anyone passes, and it read
		// as one.
		const files = context.files.filter((file) => /\.types\.ts$/.test(file))

		for (const file of files) {
			const source = await context.read(file)

			for (const prop of controlledPairsMissing(source)) {
				violations.push({
					file,
					message: `\`${prop}\` is declared with no change callback — the component looks controllable and is read-only, and the consumer finds out by typing into it`,
					rule: 'PROP-6',
				})
			}
		}

		return conclude(
			'controlled-pair',
			violations,
			files.length,
			'primitive file(s)',
		)
	},
}

/**
 * `PROP-5` / `STY-4` — every variant prop has a declared default.
 *
 * Without one, the component renders differently depending on whether the
 * caller thought about it, which makes "the default look" something no one can
 * point at.
 */
export const defaultsDeclared: Check = {
	id: 'defaults-declared',
	rules: [
		'STY-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const styles = context.files.filter((file) => /\.styles\.ts$/.test(file))

		for (const file of styles) {
			const source = await context.read(file)

			if (!/\bvariants\s*:/.test(source)) {
				continue
			}

			if (/\bdefaultVariants\s*:/.test(source)) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, source.indexOf('variants')),
				message:
					'declares variants and no defaultVariants — the component then renders differently depending on whether the caller thought about it',
				rule: 'STY-4',
			})
		}

		return conclude(
			'defaults-declared',
			violations,
			styles.length,
			'style file(s)',
		)
	},
}

/**
 * `STY-1` — styles live in the primitive's own style module.
 *
 * Inline in the component, they cannot be imported by a consumer that needs to
 * compose them, and the consumer copies them instead.
 */
export const stylesExport: Check = {
	id: 'styles-export',
	rules: [
		'STY-L1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const primitives = context.files.filter(isPrimitive)

		for (const file of primitives) {
			const styles = file.replace(/\.tsx$/, '.styles.ts')
			const source = await context.read(file)

			if (
				context.files.includes(styles) ||
				!/\b(?:cva|tv|cn)\s*\(/.test(source)
			) {
				continue
			}

			violations.push({
				file,
				message:
					'declares its variant system inline — a consumer that needs to compose the styles cannot import them, so it copies them',
				rule: 'STY-L1',
			})
		}

		return conclude(
			'styles-export',
			violations,
			primitives.length,
			'primitive(s)',
		)
	},
}

/**
 * `STY-3` — the exported union and the variant keys are the same set.
 *
 * When they drift, the type accepts a variant the styles do not implement, and
 * the component renders unstyled with nothing failing.
 */
export function variantKeys(source: string, group: string): string[] {
	const start = source.indexOf(`${group}:`)

	if (start === -1) {
		return []
	}

	const block = source.slice(start, source.indexOf('},', start) + 1)

	return [
		...block.matchAll(/^\s*(?:'([^']+)'|([a-zA-Z]\w*)):/gm),
	]
		.map((match) => match[1] ?? match[2])
		.filter((key) => key !== group)
}

export const variantUnionParity: Check = {
	id: 'variant-union-parity',
	rules: [
		'STY-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const styles = context.files.filter((file) => /\.styles\.ts$/.test(file))

		for (const file of styles) {
			const source = await context.read(file)
			const types = file.replace(/\.styles\.ts$/, '.types.ts')

			if (!context.files.includes(types)) {
				continue
			}

			const declared = await context.read(types)

			for (const group of [
				'variant',
				'size',
				'tone',
			]) {
				const keys = variantKeys(source, group)
				const union = new RegExp(
					`type \\w*${group[0].toUpperCase()}${group.slice(1)}\\s*=([^\\n;]+)`,
					'i',
				).exec(declared)

				if (keys.length === 0 || !union) {
					continue
				}

				const members = [
					...union[1].matchAll(/'([^']+)'/g),
				].map((match) => match[1])
				const missing = keys.filter((key) => !members.includes(key))

				if (missing.length === 0) {
					continue
				}

				violations.push({
					file: types,
					message: `${group}: ${missing.join(', ')} exist in the styles and not in the union — the type then accepts a variant the styles do not implement, and it renders unstyled with nothing failing`,
					rule: 'STY-3',
				})
			}
		}

		return conclude(
			'variant-union-parity',
			violations,
			styles.length,
			'style file(s)',
		)
	},
}

/**
 * `AXS-1` — an interactive element has an accessible name.
 *
 * An icon-only button is a button whose label is a picture. Screen reader users
 * hear "button", and the action is a guess.
 */
export const nameChannel: Check = {
	id: 'name-channel',
	rules: [
		'AXS-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter(
			(file) => /\.tsx$/.test(file) && !/\.test\./.test(file),
		)
		let iconOnly = 0

		for (const file of files) {
			const source = await context.read(file)

			for (const match of source.matchAll(
				/<(?:button|Button|IconButton)\b([^>]*)>\s*<(\w*Icon|Icon)\b/g,
			)) {
				iconOnly += 1

				if (/aria-label|aria-labelledby|title=/.test(match[1])) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message:
						'an icon-only control with no accessible name — a screen reader announces "button", and the action is a guess',
					rule: 'AXS-1',
				})
			}
		}

		return conclude(
			'name-channel',
			violations,
			iconOnly,
			'icon-only control(s)',
		)
	},
}

/**
 * `AXS-5` — motion respects the user's stated preference.
 *
 * `prefers-reduced-motion` is not a nicety: for some users the animation is the
 * reason they cannot use the product.
 */
export const reducedMotion: Check = {
	id: 'reduced-motion',
	rules: [
		'AXS-6',
	],
	async run(context: CheckContext) {
		const files = context.files.filter((file) => /\.(?:tsx|css)$/.test(file))
		const animated: string[] = []
		let honoured = false

		for (const file of files) {
			const source = await context.read(file)

			// One `@media (prefers-reduced-motion: reduce)` covers the whole
			// product. Demanding the opt-in per component turned a single missing
			// rule into fifty findings — the same defect fifty times, which reads
			// as a broken check rather than as one thing to go and fix.
			if (/prefers-reduced-motion/.test(source)) {
				honoured = true
			}

			if (
				!/\b(?:animate-|transition-|@keyframes|framer-motion)\b/.test(source)
			) {
				continue
			}

			animated.push(file)

			if (/motion-safe|motion-reduce|useReducedMotion/.test(source)) {
				honoured = true
			}
		}

		const violations: Violation[] =
			animated.length > 0 && !honoured
				? [
						{
							file: animated[0],
							message: `${animated.length} file(s) animate and nothing anywhere honours prefers-reduced-motion — for some users the animation is the reason they cannot use the product`,
							rule: 'AXS-6',
						},
					]
				: []

		return conclude(
			'reduced-motion',
			violations,
			animated.length,
			'animated file(s)',
		)
	},
}

export const PRIMITIVE_CHECKS: Check[] = [
	controlledPair,
	defaultsDeclared,
	nameChannel,
	reducedMotion,
	stylesExport,
	variantUnionParity,
]
