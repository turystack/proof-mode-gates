import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `ARC-LAY-6`, `ARC-LAY-7`, `ARC-TOP-4` — organization is by domain/feature,
 * a helper lives with its owner, and a folder exists when it has real code.
 *
 * The forbidden names are the ones that mean "I did not decide who owns this".
 * `support/` is allowed by the law, so it is not listed — its own rule is
 * about what may go inside it, which is not a shape a path can prove.
 */

const FORBIDDEN = [
	{
		name: 'infrastructure',
		rule: 'ARC-LAY-6',
	},
	{
		name: 'strategies',
		rule: 'ARC-LAY-6',
	},
	{
		name: 'helpers',
		rule: 'ARC-LAY-7',
	},
	{
		name: 'utils',
		rule: 'ARC-LAY-7',
	},
	{
		name: 'common',
		rule: 'ARC-LAY-7',
	},
	{
		name: 'misc',
		rule: 'ARC-LAY-7',
	},
]

export function forbiddenSegment(file: string):
	| {
			name: string
			rule: string
	  }
	| undefined {
	const segments = file.split('/')

	return FORBIDDEN.find((entry) => segments.includes(entry.name))
}

export const folderShape: Check = {
	id: 'folder-shape',
	rules: [
		'ARC-LAY-6',
		'ARC-LAY-7',
		'ARC-TOP-4',
	],
	run(context: CheckContext) {
		const violations: Violation[] = []
		const seen = new Set<string>()

		for (const file of context.files) {
			if (!file.startsWith('src/')) {
				continue
			}

			const forbidden = forbiddenSegment(file)

			if (!forbidden) {
				continue
			}

			const folder = file.slice(
				0,
				file.indexOf(`/${forbidden.name}/`) + forbidden.name.length + 2,
			)

			if (seen.has(folder)) {
				continue
			}

			seen.add(folder)
			violations.push({
				file: folder,
				message: `'${forbidden.name}/' groups by technical type instead of by owner — move each file to the domain or feature that owns it`,
				rule: forbidden.rule,
			})
		}

		return conclude(
			'folder-shape',
			violations,
			context.files.filter((file) => file.startsWith('src/')).length,
			'source file(s)',
		)
	},
}
