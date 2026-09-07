import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `ARC-ERR-1` — a domain owns its codes, under its own name.
 *
 * The risk this guards against is two codes meaning two things. A shared
 * catalogue package answered it by having one file, and paid for it: the reason
 * to raise a code lived in one package and its declaration in another, and the
 * two drifted the way that pair always does.
 *
 * The prefix answers it instead. A catalogue's module is named after the domain
 * that publishes it, one package cannot be two domains, so no two codes collide
 * — and each is declared beside the rule that raises it.
 */

const BUILDER = /createExceptions\s*\(/
const MODULE = /e\.module\(\s*'([^']+)'/g
const DOMAIN = /(?:^|\/)domains\/([^/]+)\//

export const oneCatalogue: Check = {
	id: 'one-catalogue',
	rules: [
		'ARC-ERR-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const candidates = context.files.filter(
			(file) => file.endsWith('.ts') && !file.includes('.test.'),
		)
		const builders: string[] = []
		const claimed = new Map<string, string>()

		for (const file of candidates) {
			const source = await context.read(file)

			if (!BUILDER.test(source)) {
				continue
			}

			builders.push(file)

			const domain = DOMAIN.exec(file)?.[1]

			if (!domain) {
				violations.push({
					file,
					message:
						'a catalogue outside a domain — the codes belong to the domain whose rule raises them',
					rule: 'ARC-ERR-1',
				})
				continue
			}

			for (const match of source.matchAll(MODULE)) {
				const prefix = match[1]

				if (prefix !== domain) {
					violations.push({
						file,
						message: `this catalogue publishes '${prefix}' from the ${domain} domain — the prefix is the domain's name, which is what makes it unique`,
						rule: 'ARC-ERR-1',
					})
					continue
				}

				const owner = claimed.get(prefix)

				if (owner && owner !== file) {
					violations.push({
						file,
						message: `'${prefix}' is already published by ${owner} — two catalogues under one prefix is how two codes come to mean two things`,
						rule: 'ARC-ERR-1',
					})
					continue
				}

				claimed.set(prefix, file)
			}
		}

		if (candidates.length > 0 && builders.length === 0) {
			return {
				id: 'one-catalogue',
				state: 'warn',
				summary:
					'no catalogue found — fine while the project raises no domain errors, a finding once it does',
				violations,
			}
		}

		return conclude(
			'one-catalogue',
			violations,
			builders.length,
			'catalogue(s)',
		)
	},
}
