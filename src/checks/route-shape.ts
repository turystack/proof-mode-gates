import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `CTL-7` — a business action is a custom method (`::verb`, POST); a path
 * segment names a resource, never an action.
 *
 * Two shapes are caught. The obvious one is a verb as a segment
 * (`:invoiceId/pay`). The one that gets through a verb blacklist is a
 * **nominalized** action wearing a noun's coat (`:orderId/cancellation-impact`)
 * — which is why the rule is expressed positively: a segment must read as a
 * collection, so it is a lowercase plural with no hyphen.
 *
 * The limit is real and stated in the skill: a plural nominalization
 * (`/cancellations`) satisfies the shape and still names an action. That part
 * of `CTL-7` stays `manual`.
 */

const ROUTE_PATH = /@Route\(\s*\{[^}]*?path:\s*'([^']*)'/gs
const ROUTE_METHOD = /method:\s*'([A-Z]+)'/
const CUSTOM_METHOD = /::[a-z][a-zA-Z]*$/

/** Segments that are structure, not resources. */
const STRUCTURAL = new Set([
	'api',
	'v1',
	'v2',
	'app',
	'bko',
	'ops',
	'admin',
	'internal',
	'webhooks',
])

export function inspectRoutePath(
	path: string,
	method: string,
): string | undefined {
	if (CUSTOM_METHOD.test(path)) {
		return method === 'POST'
			? undefined
			: `custom method '${path}' must be POST, not ${method}`
	}

	for (const segment of path.split('/')) {
		if (!segment || segment.startsWith(':') || STRUCTURAL.has(segment)) {
			continue
		}

		if (segment.includes('-')) {
			return `segment '${segment}' is hyphenated, which reads as an action rather than a resource — a business action is a '::verb' custom method`
		}

		if (!segment.endsWith('s')) {
			return `segment '${segment}' is singular, so it does not name a collection — a business action is a '::verb' custom method`
		}
	}

	return undefined
}

export const routeShape: Check = {
	id: 'route-shape',
	rules: [
		'CTL-7',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const controllers = context.files.filter((file) =>
			file.endsWith('.controller.ts'),
		)

		for (const file of controllers) {
			const source = await context.read(file)

			for (const match of source.matchAll(ROUTE_PATH)) {
				const block = match[0]
				const path = match[1]
				const method = ROUTE_METHOD.exec(block)?.[1] ?? 'GET'
				const problem = inspectRoutePath(path, method)

				if (problem) {
					violations.push({
						file,
						line: source.slice(0, match.index).split('\n').length,
						message: problem,
						rule: 'CTL-7',
					})
				}
			}
		}

		return conclude(
			'route-shape',
			violations,
			controllers.length,
			'controller(s)',
		)
	},
}
