import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `CTL-4` / `ARC-SEC-3` — every route that changes something states who may
 * do it, over which resource.
 *
 * The check is on mutating methods only. A `GET` may be public by design; a
 * `POST` that nobody authorized is either a hole or a decision nobody wrote
 * down, and both deserve to be seen. A route deliberately public says so with
 * `@Public()`, which is the difference between a decision and an omission.
 */

const ROUTE_BLOCK = /@Route\(\s*\{[\s\S]*?\}\s*\)/g
const METHOD = /method:\s*'([A-Z]+)'/
const PATH = /path:\s*'([^']*)'/
const MUTATING = new Set([
	'POST',
	'PUT',
	'PATCH',
	'DELETE',
])

/** Decorators that answer "who may do this", in any order, above the route. */
const AUTHORIZED = /@(?:ACL|Public|Webhook)\s*\(/

/**
 * Only the decorators attached to *this* route count.
 *
 * A fixed window around the route does not work: the neighbour's `@ACL` sits
 * well inside it, so an unguarded route between two guarded ones reads as
 * covered. The boundary is the end of the previous member — the last `}` or the
 * class's opening `{` — and nothing before it belongs to this route.
 */
export function routeIsAuthorized(source: string, blockStart: number): boolean {
	const before = source.slice(0, blockStart)
	const boundary = Math.max(before.lastIndexOf('}'), before.lastIndexOf('{'))
	const attached = before.slice(boundary + 1)

	return AUTHORIZED.test(attached)
}

export const aclCoverage: Check = {
	id: 'acl-coverage',
	rules: [
		'CTL-4',
		'ARC-SEC-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const controllers = context.files.filter((file) =>
			file.endsWith('.controller.ts'),
		)

		let routes = 0

		for (const file of controllers) {
			const source = await context.read(file)

			for (const match of source.matchAll(ROUTE_BLOCK)) {
				const block = match[0]
				const method = METHOD.exec(block)?.[1] ?? 'GET'
				routes += 1

				if (!MUTATING.has(method)) {
					continue
				}

				if (routeIsAuthorized(source, match.index ?? 0)) {
					continue
				}

				violations.push({
					file,
					line: source.slice(0, match.index).split('\n').length,
					message: `${method} ${PATH.exec(block)?.[1] ?? ''} has no @ACL — a mutating route states the operation and the scope, or declares itself @Public`,
					rule: 'CTL-4',
				})
			}
		}

		return conclude(
			'acl-coverage',
			violations,
			routes,
			`route(s) across ${controllers.length} controller(s)`,
		)
	},
}
