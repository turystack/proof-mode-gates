import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `CTL-5` — endpoints listed GET → POST → PUT → PATCH → DELETE.
 *
 * Small rule, real payoff: a controller read in a fixed order is a controller
 * where a missing endpoint is visible. It also removes an argument nobody
 * benefits from having twice.
 */

const ORDER = [
	'GET',
	'POST',
	'PUT',
	'PATCH',
	'DELETE',
]
const METHOD = /@Route\(\s*\{[^}]*?method:\s*'([A-Z]+)'/gs

export function firstOutOfOrder(methods: string[]): number {
	let highest = -1

	for (const [index, method] of methods.entries()) {
		const rank = ORDER.indexOf(method)

		if (rank === -1) {
			continue
		}

		if (rank < highest) {
			return index
		}

		highest = rank
	}

	return -1
}

export const routeOrder: Check = {
	id: 'route-order',
	rules: [
		'CTL-5',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const controllers = context.files.filter((file) =>
			file.endsWith('.controller.ts'),
		)

		for (const file of controllers) {
			const source = await context.read(file)
			const matches = [
				...source.matchAll(METHOD),
			]
			const methods = matches.map((match) => match[1])
			const index = firstOutOfOrder(methods)

			if (index === -1) {
				continue
			}

			violations.push({
				file,
				line: source.slice(0, matches[index].index).split('\n').length,
				message: `${methods[index]} appears after ${methods[index - 1]} — endpoints are listed ${ORDER.join(' → ')}`,
				rule: 'CTL-5',
			})
		}

		return conclude(
			'route-order',
			violations,
			controllers.length,
			'controller(s)',
		)
	},
}
