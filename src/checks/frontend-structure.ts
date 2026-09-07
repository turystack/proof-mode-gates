import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'

/**
 * Placement and wiring laws for the application layer.
 *
 * The theme running through them: a decision that belongs to the route tree —
 * who may enter, what the address carries, what happens when it throws — must
 * be visible *in* the route tree. Pushed down into a component it becomes a
 * decision you can only find by rendering the screen.
 */

const isRoute = (file: string) => /(?:^|\/)routes?\/.+\.tsx$/.test(file)

/**
 * `RTE-4` — authorization is declared on the route, not inside the screen.
 *
 * A screen that checks permission has already mounted, already fetched, and
 * already told the user this page exists. The route is the only place where
 * "no" costs nothing.
 */
export const authGatePlacement: Check = {
	id: 'auth-gate-placement',
	rules: [
		'RTE-4',
		'SEC-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const screens = context.files.filter(
			(file) => /\.(?:page|screen)\.tsx$/.test(file) && !isRoute(file),
		)

		for (const file of screens) {
			const source = await context.read(file)
			const match =
				/\b(?:if\s*\(\s*)?(?:!?\s*(?:can|hasPermission|isAllowed|useCan)\s*\()/.exec(
					source,
				)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'decides access inside the screen — by then it has mounted, fetched and told the user the page exists; declare it on the route',
				rule: 'RTE-4',
			})
		}

		return conclude(
			'auth-gate-placement',
			violations,
			screens.length,
			'screen(s)',
		)
	},
}

/**
 * `ARC-DEL-7` / `RTE-2` — a screen is reachable by its address alone.
 *
 * A route that only works when you arrive from somewhere else cannot be
 * bookmarked, shared or reloaded, which is three quarters of how people
 * actually use a URL.
 */
export const deepLink: Check = {
	id: 'deep-link',
	rules: [
		'ARC-DEL-7',
		'RTE-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const routes = context.files.filter(isRoute)

		for (const file of routes) {
			const source = await context.read(file)
			const match = /\b(?:location|useLocation\(\))\.state\b/.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'reads router state the address does not carry — the screen then cannot be bookmarked, shared or reloaded, which is most of what a URL is for',
				rule: 'ARC-DEL-7',
			})
		}

		return conclude('deep-link', violations, routes.length, 'route(s)')
	},
}

/**
 * `RTE-3` — the search params a route accepts are declared and validated.
 *
 * Undeclared, a hand-edited URL reaches the screen as whatever the user typed,
 * and the first thing that treats it as a number gets a string.
 */
export const searchSchema: Check = {
	id: 'search-schema',
	rules: [
		'RTE-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const routes = context.files.filter(isRoute)
		let usingSearch = 0

		for (const file of routes) {
			const source = await context.read(file)

			if (!/\buseSearch\b|\bsearchParams\b/.test(source)) {
				continue
			}

			usingSearch += 1

			if (/validateSearch|searchSchema|\.parse\(/.test(source)) {
				continue
			}

			violations.push({
				file,
				message:
					'reads search params it never declared — a hand-edited URL then arrives as whatever was typed, and the first thing treating it as a number gets a string',
				rule: 'RTE-3',
			})
		}

		return conclude(
			'search-schema',
			violations,
			usingSearch,
			'route(s) reading search',
		)
	},
}

/**
 * `ERR-4` — a route subtree has an error boundary.
 *
 * Without one, a throw anywhere below unmounts the whole application and the
 * user gets a blank page, which is the one state no design ever specified.
 */
export const errorBoundary: Check = {
	id: 'error-boundary',
	rules: [
		'ERR-4',
	],
	async run(context: CheckContext) {
		const routes = context.files.filter(isRoute)

		if (routes.length === 0) {
			return {
				id: 'error-boundary',
				state: 'skipped',
				summary: 'no route to inspect',
				violations: [],
			}
		}

		let boundaries = 0

		for (const file of routes) {
			const source = await context.read(file)

			if (/errorComponent|ErrorBoundary|componentDidCatch/.test(source)) {
				boundaries += 1
			}
		}

		return boundaries > 0
			? {
					id: 'error-boundary',
					state: 'pass',
					summary: `${boundaries} of ${routes.length} route(s) declare a boundary`,
					violations: [],
				}
			: {
					id: 'error-boundary',
					state: 'fail',
					summary: `${routes.length} route(s), no error boundary anywhere`,
					violations: [
						{
							file: routes[0],
							message:
								'no error boundary in the route tree — a throw below then unmounts the application and the user gets a blank page, the one state no design specified',
							rule: 'ERR-4',
						},
					],
				}
	},
}

/**
 * `PRF-1` — a route is split from the shell.
 *
 * Without splitting, opening the login page downloads the admin area, and the
 * first paint waits on code the visitor will never run.
 */
export const routeSplitting: Check = {
	id: 'route-splitting',
	rules: [
		'PRF-1',
	],
	async run(context: CheckContext) {
		const routes = context.files.filter(isRoute)

		if (routes.length < 3) {
			return {
				id: 'route-splitting',
				state: 'skipped',
				summary: 'fewer than three routes — splitting is not yet a decision',
				violations: [],
			}
		}

		let lazy = 0

		for (const file of routes) {
			const source = await context.read(file)

			if (/\blazy\b|React\.lazy|import\(/.test(source)) {
				lazy += 1
			}
		}

		return lazy > 0
			? {
					id: 'route-splitting',
					state: 'pass',
					summary: `${lazy} of ${routes.length} route(s) load lazily`,
					violations: [],
				}
			: {
					id: 'route-splitting',
					state: 'fail',
					summary: `${routes.length} route(s), none split`,
					violations: [
						{
							file: routes[0],
							message:
								'every route is in the initial bundle — opening the login page then downloads the admin area, and the first paint waits on code the visitor never runs',
							rule: 'PRF-1',
						},
					],
				}
	},
}

/**
 * `PRF-2` — the bundle is measured against a budget it declares.
 *
 * A budget that lives in someone's head is a budget that is exceeded gradually
 * and noticed once, by a user on a slow connection.
 */
export const bundleBudget: Check = {
	id: 'bundle-budget',
	rules: [
		'PRF-2',
	],
	async run(context: CheckContext) {
		const declared = context.files.find((file) =>
			/(?:bundlesize|size-limit)\.(?:json|jsonc|config\.[cm]?[jt]s)$|\.size-limit\.json$/.test(
				file,
			),
		)

		const hasBundler = context.files.some((file) =>
			/vite\.config\.[cm]?[jt]s$/.test(file),
		)

		if (!hasBundler) {
			return {
				id: 'bundle-budget',
				state: 'skipped',
				summary: 'no bundled application here',
				violations: [],
			}
		}

		if (declared) {
			return {
				id: 'bundle-budget',
				state: 'pass',
				summary: `budget declared in ${declared}`,
				violations: [],
			}
		}

		return {
			id: 'bundle-budget',
			state: 'fail',
			summary: 'no bundle budget declared',
			violations: [
				{
					file: 'package.json',
					message:
						'no size-limit/bundlesize budget — an undeclared budget is exceeded gradually and noticed once, by a user on a slow connection',
					rule: 'PRF-2',
				},
			],
		}
	},
}

/**
 * `USO-5` — a primitive that exists is not built a second time.
 *
 * Two buttons is not twice the work; it is a permanent question about which one
 * a new screen should use, answered differently every time.
 */
export const noDuplicatePrimitive: Check = {
	id: 'no-duplicate-primitive',
	rules: [
		'USO-5',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const local = context.files.filter((file) =>
			/(?:^|\/)components\/(?:ui\/)?([^/]+)\/\1\.tsx$/.test(file),
		)

		for (const file of local) {
			const name = /components\/(?:ui\/)?([^/]+)\//.exec(file)?.[1] ?? ''
			const source = await context.read(file)

			if (!/@turystack\/react-web/.test(source) && name.length > 0) {
				continue
			}

			violations.push({
				file,
				message: `'${name}' re-declares a primitive the library already ships — two of them is a permanent question about which one a new screen should use`,
				rule: 'USO-5',
			})
		}

		return conclude(
			'no-duplicate-primitive',
			violations,
			local.length,
			'local primitive(s)',
		)
	},
}

/**
 * `CMP-1` — component files are kebab-case.
 *
 * The reason is not taste. Two casings on a case-insensitive filesystem is an
 * import that resolves locally and fails in CI, and the diff shows nothing.
 */
export function isKebab(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

export const kebabCase: Check = {
	id: 'kebab-case',
	rules: [
		'CMP-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) => /\.tsx$/.test(file))

		for (const file of files) {
			const base = file.split('/').pop() ?? ''
			const stem = base.split('.')[0]

			if (isKebab(stem)) {
				continue
			}

			violations.push({
				file,
				message: `'${base}' is not kebab-case — two casings on a case-insensitive filesystem is an import that resolves locally and fails in CI, with nothing in the diff`,
				rule: 'CMP-4',
			})
		}

		return conclude('kebab-case', violations, files.length, 'component file(s)')
	},
}

/**
 * `UST-10` — the five outcomes come from one derivation, not from five `if`s.
 *
 * A remote read has pending, denied, error, empty and success, and the order
 * between them is law: a denial decided after the generic error branch is
 * swallowed by it, and the user is offered a retry that can never work.
 * Restating that order per surface means restating it wrongly somewhere, and
 * the wrong one is invisible until a customer hits it.
 */
export const dataOutcome: Check = {
	id: 'data-outcome',
	rules: [
		'UST-10',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter(
			(file) =>
				/(?:^|\/)features\/.+\.tsx?$/.test(file) &&
				!/\.(?:test|spec|stories)\.tsx?$/.test(file),
		)
		let readers = 0

		for (const file of files) {
			const source = await context.read(file)

			if (!/from\s+'[^']*~sdk[^']*'/.test(source)) {
				continue
			}

			const match = /\buse(?:List|Get)[A-Z]\w*\s*\(/.exec(source)

			if (!match) {
				continue
			}

			readers += 1

			if (/\buseDataOutcome\s*\(/.test(source)) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'reads from the SDK and decides the outcome by hand — derive it once with useDataOutcome, so pending, denied, error, empty and success keep the order the law gives them',
				rule: 'UST-10',
			})
		}

		return conclude('data-outcome', violations, readers, 'remote read(s)')
	},
}

export const FRONTEND_STRUCTURE_CHECKS: Check[] = [
	authGatePlacement,
	bundleBudget,
	dataOutcome,
	deepLink,
	errorBoundary,
	kebabCase,
	noDuplicatePrimitive,
	routeSplitting,
	searchSchema,
]
