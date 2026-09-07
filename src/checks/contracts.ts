import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { aside, scannable } from '@/checks/scope.js'

/**
 * The contract is the only thing the two sides share.
 *
 * Every law here protects the same property: there is exactly one description
 * of the wire, it is generated, and neither side keeps a private copy. A second
 * copy is not a duplicate — it is a second contract that nobody will remember
 * to change.
 */

const isGenerated = (file: string) =>
	/(?:^|\/)(?:generated|__generated__|sdk)\//.test(file)

/**
 * Where an import actually lands, as a repository-relative path.
 *
 * Matching the specifier as written only catches absolute imports, and the
 * imports that cross a boundary are almost always relative — `../billing/…` is
 * the exact shape these two laws exist to catch. A check that reads the string
 * instead of resolving it passes the violation it was written for.
 */
export function resolveImport(from: string, specifier: string): string {
	if (!specifier.startsWith('.')) {
		return specifier
	}

	const segments = from.split('/').slice(0, -1)

	for (const part of specifier.split('/')) {
		if (part === '..') {
			segments.pop()
		} else if (part !== '.') {
			segments.push(part)
		}
	}

	return segments.join('/')
}

/**
 * `ARC-CTR-2` — a contract change is visible as a contract change.
 *
 * A task that edits a schema and does not regenerate leaves the published
 * contract describing the previous shape, which is worse than no contract:
 * the consumer trusts it.
 */
export const contractDelta: Check = {
	id: 'contract-delta',
	rules: [
		'ARC-CTR-2',
		'DLV-14',
	],
	async run(context: CheckContext) {
		const touchedSchemas = context.changed.filter((file) =>
			/\.schema\.ts$/.test(file),
		)
		const touchedContract = context.changed.some(
			(file) => isGenerated(file) || /openapi|contract\.json/.test(file),
		)

		if (touchedSchemas.length === 0) {
			return {
				id: 'contract-delta',
				state: 'skipped',
				summary: 'no schema changed in this task',
				violations: [],
			}
		}

		if (touchedContract) {
			return {
				id: 'contract-delta',
				state: 'pass',
				summary: `${touchedSchemas.length} schema(s) changed, contract regenerated`,
				violations: [],
			}
		}

		return {
			id: 'contract-delta',
			state: 'fail',
			summary: `${touchedSchemas.length} schema(s) changed with no contract regenerated`,
			violations: touchedSchemas.map((file) => ({
				file,
				message:
					'the schema changed and the generated contract did not — the published contract now describes the previous shape, and the consumer trusts it',
				rule: 'ARC-CTR-2',
			})),
		}
	},
}

/**
 * `ARC-CTR-3` — the frontend consumes the generated SDK, never a hand-written
 * twin of it.
 *
 * The twin compiles. That is the problem: it keeps compiling after the contract
 * moves, and the mismatch surfaces as a runtime undefined in the one
 * environment with real data.
 */
export const sdkShadow: Check = {
	id: 'sdk-shadow',
	rules: [
		'ARC-CTR-3',
		'API-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter(
			(file) =>
				/\.(?:ts|tsx)$/.test(file) &&
				!isGenerated(file) &&
				!/\.test\./.test(file),
		)

		for (const file of files) {
			const source = await context.read(file).catch(() => '')

			for (const match of source.matchAll(
				/\b(?:fetch|axios)\s*(?:\.\w+)?\(\s*[`'"]\/api\//g,
			)) {
				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message:
						'calls /api directly — a hand-written client keeps compiling after the contract moves, and the mismatch surfaces as undefined in production',
					rule: 'ARC-CTR-3',
				})
			}
		}

		return conclude('sdk-shadow', violations, files.length, 'source file(s)')
	},
}

/**
 * `CMP-2` — a type is imported from the package's root barrel, never deep.
 *
 * A consumer that imports the type from anywhere but the primitive's own
 * barrel is importing a copy, and a copy is a contract with a second author.
 */
export const contractSync: Check = {
	id: 'contract-sync',
	rules: [
		'CMP-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) => /\.tsx$/.test(file))

		for (const file of files) {
			const source = await context.read(file).catch(() => '')

			for (const match of source.matchAll(
				/import\s+type\s*\{[^}]*\}\s*from\s*'[^']*@turystack\/react-web\/(?:src|dist)\/[^']*'/g,
			)) {
				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message:
						'reaches past the package entry point for a type — import from the package root, or the contract acquires a second author',
					rule: 'CMP-2',
				})
			}
		}

		return conclude(
			'contract-sync',
			violations,
			files.length,
			'component file(s)',
		)
	},
}

/**
 * `ARC-TOP-2` — a domain concept lives in its domain.
 *
 * A domain folder that imports another domain's internals has stopped being a
 * boundary: the two now deploy, test and fail together.
 */
export const domainPlacement: Check = {
	id: 'domain-placement',
	rules: [
		'ARC-TOP-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) =>
			/(?:^|\/)domains?\//.test(file),
		)
		const domainOf = (file: string) => /domains?\/([^/]+)\//.exec(file)?.[1]

		for (const file of files) {
			const owner = domainOf(file)
			const source = await context.read(file).catch(() => '')

			for (const match of source.matchAll(/from '([^']+)'/g)) {
				const target = resolveImport(file, match[1])
				const reached = /domains?\/([^/]+)\/(.+)/.exec(target)

				if (!reached || reached[1] === owner || /^index\./.test(reached[2])) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `reaches into domain '${reached[1]}' past its entry point — the two domains now deploy, test and fail together`,
					rule: 'ARC-TOP-2',
				})
			}
		}

		return conclude(
			'domain-placement',
			violations,
			files.length,
			'domain file(s)',
		)
	},
}

/**
 * `ARC-CON-8` — a mutation says what it invalidated.
 *
 * Without it the screen keeps showing the value from before the write, and the
 * user's only recourse is a reload — which is the bug report you get.
 */
export const mutationInvalidates: Check = {
	id: 'mutation-invalidates',
	rules: [
		'ARC-CON-8',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files } = await scannable(context, (file) =>
			/\.(?:ts|tsx)$/.test(file),
		)
		let mutations = 0

		for (const file of files) {
			const source = await context.read(file).catch(() => '')

			for (const match of source.matchAll(/useMutation\s*\(/g)) {
				mutations += 1
				const tail = source.slice(match.index)
				const block = tail.slice(0, tail.indexOf('\n})') + 3)

				if (/invalidateQueries|setQueryData|refetch/.test(block)) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message:
						"the mutation invalidates nothing — the screen keeps the value from before the write, and the user's only recourse is a reload",
					rule: 'ARC-CON-8',
				})
			}
		}

		return conclude(
			'mutation-invalidates',
			violations,
			mutations,
			'mutation(s)',
			aside(excluded),
		)
	},
}

/**
 * A realtime subscription, not every `.on()` in the language.
 *
 * Matched loosely, this counted `child.stdout.on('data')` and `child.on('exit')`
 * as one channel with three owners — a CLI spawning a subprocess became a
 * finding about websockets. The receiver has to name itself, or the call has to
 * be `subscribe`, which nothing but a subscription is called.
 */
const REALTIME_SUBSCRIPTION =
	/\b(?:socket|channel|realtime|ws|pusher|ably|broadcast|subscription)\w*\.(?:subscribe|on)\(\s*'([^']+)'|\.subscribe\(\s*'([^']+)'/gi

/**
 * `API-8` — a real-time subscription has one owner.
 *
 * Subscribed in two components, the same message is handled twice, and the
 * second handler is the one nobody remembers writing.
 */
export const realtimeOwner: Check = {
	id: 'realtime-owner',
	rules: [
		'API-8',
	],
	async run(context: CheckContext) {
		const owners = new Map<string, string[]>()
		const { excluded, files } = await scannable(context, (file) =>
			/\.(?:ts|tsx)$/.test(file),
		)

		for (const file of files) {
			const source = await context.read(file).catch(() => '')

			for (const match of source.matchAll(REALTIME_SUBSCRIPTION)) {
				const channel = match[1] ?? match[2]

				if (!channel) {
					continue
				}

				owners.set(channel, [
					...(owners.get(channel) ?? []),
					file,
				])
			}
		}

		const violations: Violation[] = []

		for (const [channel, subscribers] of owners) {
			if (subscribers.length < 2) {
				continue
			}

			violations.push({
				file: subscribers[1],
				message: `'${channel}' is subscribed in ${subscribers.length} places (${subscribers.join(', ')}) — the same message is then handled twice`,
				rule: 'API-8',
			})
		}

		return conclude(
			'realtime-owner',
			violations,
			owners.size,
			'subscription(s)',
			aside(excluded),
		)
	},
}

export const CONTRACT_CHECKS: Check[] = [
	contractDelta,
	contractSync,
	domainPlacement,
	mutationInvalidates,
	realtimeOwner,
	sdkShadow,
]
