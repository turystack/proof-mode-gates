import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `PRJ-4`, `PRJ-5` — how a domain package is laid out inside.
 *
 * A domain with one aggregate keeps its files at its root, and most domains
 * have one. A domain with several — identity holds the person, the
 * organizations they act for, the roles those carry and the codes they sign in
 * with — gives each its own folder under `entities/`. Flattened, the files
 * interleave by role rather than by owner, and the `iam.types.ts` that appears
 * to hold the leftovers is a file every folder imports from and therefore every
 * folder is coupled to.
 *
 * This is a path check because placement is what the law is about. It reads no
 * source: a file's owner is its name, and where it sits is the claim.
 */

/** The files that belong to an aggregate rather than to an operation. */
const ROLE = /\.(?:schema|types|entity|repository|mock)\.ts$/

/** `domains/<name>/…` reached from a package root or from inside an app. */
const DOMAIN = /^(.*?domains\/[^/]+\/)(?:src\/)?(.+)$/

type Placed = {
	/** Where the file sits, after `src/`. */
	inner: string
	prefix: string
}

export function aggregatesOf(files: string[]): Map<string, Placed[]> {
	const domains = new Map<string, Placed[]>()

	for (const file of files) {
		const match = DOMAIN.exec(file)
		const inner = match?.[2]

		if (!match?.[1] || !inner) {
			continue
		}

		if (inner.startsWith('use-cases/') || !ROLE.test(inner)) {
			continue
		}

		const placed = domains.get(match[1]) ?? []

		placed.push({
			inner,
			prefix: (inner.split('/').pop() ?? '').split('.')[0] ?? '',
		})
		domains.set(match[1], placed)
	}

	return domains
}

export const domainAnatomy: Check = {
	id: 'domain-anatomy',
	rules: [
		'PRJ-4',
		'PRJ-5',
	],
	run(context: CheckContext) {
		const violations: Violation[] = []
		const domains = aggregatesOf(context.files)

		for (const [domain, placed] of domains) {
			const aggregates = new Set(placed.map((entry) => entry.prefix))

			// One aggregate, one prefix: the domain root is where its files
			// belong, and a folder for the only thing in the package says nothing.
			if (aggregates.size < 2) {
				continue
			}

			for (const entry of placed) {
				if (
					entry.inner ===
					`entities/${entry.prefix}/${entry.inner.split('/').pop()}`
				) {
					continue
				}

				violations.push({
					file: `${domain}src/${entry.inner}`,
					message: `this domain holds ${aggregates.size} aggregates, so this belongs in \`entities/${entry.prefix}/\` — a file covering all of them is one every folder is coupled to`,
					rule: 'PRJ-4',
				})
			}
		}

		// Every aggregate is the same six files. The one that is missing is
		// always the one nobody thought the aggregate needed — a workspace with
		// no entity, a permission with no repository — and then the use case
		// reaches the table directly because there is nothing else to call.
		const held = new Map<string, Set<string>>()

		for (const file of context.files) {
			const match = /(?:^|\/)entities\/([^/]+)\/([^/]+)$/.exec(file)
			const name = match?.[2]

			if (!match?.[1] || !name) {
				continue
			}

			const folder = file.slice(0, file.lastIndexOf('/'))
			const seen = held.get(folder) ?? new Set<string>()

			seen.add(name)
			held.set(folder, seen)
		}

		for (const [folder, seen] of held) {
			const aggregate = folder.split('/').pop() ?? ''

			for (const required of [
				`${aggregate}.schema.ts`,
				`${aggregate}.types.ts`,
				`${aggregate}.entity.ts`,
				`${aggregate}.repository.ts`,
				`${aggregate}.mock.ts`,
				'index.ts',
			]) {
				if (!seen.has(required)) {
					violations.push({
						file: folder,
						message: `no ${required} — every aggregate is the same six files, and the missing one is where a use case starts reaching the table instead`,
						rule: 'PRJ-4',
					})
				}
			}
		}

		// An operation is a folder holding the operation and a barrel. The
		// barrel is what the domain's own index imports, so adding a file to an
		// operation never changes the line that exports it.
		const operations = new Map<string, Set<string>>()

		for (const file of context.files) {
			const match = /(?:^|\/)use-cases\/([^/]+)\/([^/]+)$/.exec(file)
			const name = match?.[2]

			if (!match?.[1] || !name) {
				continue
			}

			const folder = file.slice(0, file.lastIndexOf('/'))
			const held = operations.get(folder) ?? new Set<string>()

			held.add(name)
			operations.set(folder, held)
		}

		for (const [folder, held] of operations) {
			const operation = folder.split('/').pop() ?? ''

			for (const required of [
				`${operation}.ts`,
				'index.ts',
			]) {
				if (!held.has(required)) {
					violations.push({
						file: folder,
						message: `no ${required} in this operation's folder`,
						rule: 'PRJ-5',
					})
				}
			}
		}

		return conclude(
			'domain-anatomy',
			violations,
			domains.size,
			'domain package(s)',
		)
	},
}
