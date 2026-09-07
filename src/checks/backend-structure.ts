import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { resolveImport } from '@/checks/contracts.js'

/**
 * The placement laws of a backend feature.
 *
 * These are the rules a lint rule cannot reach: they are about which file a
 * declaration lives in, and which files exist beside it. A GritQL plugin sees
 * one syntax tree with no path attached; a structural check has the tree of the
 * project, which is exactly what "placement" means.
 */

const isFeature = (file: string) => /(?:^|\/)(?:src\/)?features\//.test(file)

const DATA_VERB =
	/^(?:find|get|list|search|count|exists|save|insert|create|update|upsert|delete|remove|stream)/

/** Class members, roughly: a name followed by an argument list, at indent. */
const MEMBER =
	/^\s{2}(?:public |private |protected |readonly |async |static )*([a-zA-Z_]\w*)\s*[(<]/gm

/**
 * `REP-1` — the repository moves rows, the use case decides.
 *
 * The check is positive on purpose. A blacklist of business verbs catches
 * `cancelOrder` and misses `orderCancellation`, which is the same decision
 * wearing a noun. Requiring a data verb catches both, and it is the shape the
 * law actually states.
 */
export function offendingRepositoryMembers(source: string): string[] {
	return [
		...source.matchAll(MEMBER),
	]
		.map((match) => match[1])
		.filter((name) => name !== 'constructor' && !DATA_VERB.test(name))
}

export const noBusinessVerbInRepo: Check = {
	id: 'no-business-verb-in-repo',
	rules: [
		'REP-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) =>
			/\.repository\.(?:ts|impl\.ts)$/.test(file),
		)

		for (const file of files) {
			const source = await context.read(file)

			for (const name of offendingRepositoryMembers(source)) {
				violations.push({
					file,
					line: lineOf(source, source.indexOf(name)),
					message: `\`${name}\` is not a data verb — a repository speaks in find/save/update/delete, so the decision stays in the use case`,
					rule: 'REP-1',
				})
			}
		}

		return conclude(
			'no-business-verb-in-repo',
			violations,
			files.length,
			'repository file(s)',
		)
	},
}

/**
 * `ADP-1` — an adapter is a port and an implementation, in that order.
 *
 * The port is what the domain depends on; without it the "adapter" is just a
 * class the use case imports directly, and the boundary it was supposed to
 * create does not exist.
 */
export const adapterStructure: Check = {
	id: 'adapter-structure',
	rules: [
		'ADP-1',
		'ADP-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const implementations = context.files.filter((file) =>
			/\.adapter\.ts$/.test(file),
		)

		for (const file of implementations) {
			const port = file.replace(/\.adapter\.ts$/, '.port.ts')

			if (!context.files.includes(port)) {
				violations.push({
					file,
					message: `no ${port.split('/').pop()} beside it — without a port the domain depends on the implementation, which is the boundary this file exists to create`,
					rule: 'ADP-1',
				})
			}
		}

		return conclude(
			'adapter-structure',
			violations,
			implementations.length,
			'adapter(s)',
		)
	},
}

/**
 * `ENT-1` — an entity declares its persistence mapping where the entity is.
 *
 * A mapping declared elsewhere drifts: the entity gains a field, the mapping
 * does not, and the column that was never created fails at runtime in the one
 * environment that has real data.
 */
export const entityDecorator: Check = {
	id: 'entity-decorator',
	rules: [
		'ENT-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const entities = context.files.filter((file) => /\.entity\.ts$/.test(file))

		for (const file of entities) {
			const source = await context.read(file)

			if (/@Entity\s*\(/.test(source)) {
				continue
			}

			violations.push({
				file,
				message:
					'no @Entity() — the persistence mapping belongs on the entity, where a new field cannot be added without seeing it',
				rule: 'ENT-1',
			})
		}

		return conclude(
			'entity-decorator',
			violations,
			entities.length,
			'entity file(s)',
		)
	},
}

/**
 * `SCH-1` — one role per file.
 *
 * A file that declares the canonical schema *and* the transport DTOs makes the
 * import graph lie: everything that wants the shape now also depends on the
 * transport, and the transport cannot change without touching the domain.
 */
export const fileRoles: Check = {
	id: 'file-roles',
	rules: [
		'SCH-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const schemas = context.files.filter((file) => /\.schema\.ts$/.test(file))

		for (const file of schemas) {
			const source = await context.read(file)
			const hasDto = /export (?:const|type) \w+(?:Request|Response)\b/.test(
				source,
			)
			const hasCanonical = /export const \w+Schema\b/.test(source)

			if (hasDto && hasCanonical) {
				violations.push({
					file,
					line: lineOf(
						source,
						source.search(/export (?:const|type) \w+(?:Request|Response)\b/),
					),
					message:
						'the canonical schema and its transport DTOs share a file — everything importing the shape then depends on the transport too',
					rule: 'SCH-1',
				})
			}
		}

		return conclude('file-roles', violations, schemas.length, 'schema file(s)')
	},
}

/**
 * `SCH-4` — a field carries the metadata the generated contract needs.
 *
 * Without `.describe()` the published contract has a field name and a type, and
 * the consumer has to guess the rest. The generator can only publish what the
 * schema declared.
 */
export const schemaMetadata: Check = {
	id: 'schema-metadata',
	rules: [
		'SCH-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const schemas = context.files.filter((file) => /\.schema\.ts$/.test(file))

		for (const file of schemas) {
			const source = await context.read(file)
			const objects = [
				...source.matchAll(/export const (\w+Schema)\s*=\s*z\.object\(/g),
			]

			for (const match of objects) {
				const tail = source.slice(match.index)
				const block = tail.slice(0, tail.indexOf('\n})') + 3)

				if (block.includes('.describe(')) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `${match[1]} declares no .describe() — the generated contract can only publish what the schema said`,
					rule: 'SCH-4',
				})
			}
		}

		return conclude(
			'schema-metadata',
			violations,
			schemas.length,
			'schema file(s)',
		)
	},
}

/**
 * `UC-1` — a use case exposes one entry point.
 *
 * Two public methods on a use case means two operations sharing a name, and the
 * name stops telling the reader what the class does. The second one is a new
 * use case that has not been given its file yet.
 */
export function publicUseCaseMembers(source: string): string[] {
	return [
		...source.matchAll(MEMBER),
	]
		.map((match) => match[1])
		.filter((name) => name !== 'constructor' && !name.startsWith('#'))
		.filter(
			(name) => !new RegExp(`private (?:async )?${name}\\s*\\(`).test(source),
		)
}

export const useCaseShape: Check = {
	id: 'use-case-shape',
	rules: [
		'UC-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const useCases = context.files.filter((file) =>
			/\.use-case\.ts$/.test(file),
		)

		for (const file of useCases) {
			const source = await context.read(file)
			const members = publicUseCaseMembers(source)

			if (members.length <= 1) {
				continue
			}

			violations.push({
				file,
				message: `${members.length} public entry points (${members.join(', ')}) — a use case is one operation; the others are use cases without a file yet`,
				rule: 'UC-1',
			})
		}

		return conclude(
			'use-case-shape',
			violations,
			useCases.length,
			'use case(s)',
		)
	},
}

/**
 * `CTL-2` — a route declares the schema it validates against.
 *
 * A route with no schema accepts whatever arrives and discovers the shape by
 * failing somewhere deeper, where the error no longer names the input.
 */
export const routeSchemas: Check = {
	id: 'route-schemas',
	rules: [
		'CTL-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const controllers = context.files.filter((file) =>
			file.endsWith('.controller.ts'),
		)
		let routes = 0

		for (const file of controllers) {
			const source = await context.read(file)

			for (const match of source.matchAll(/@Route\(\s*\{[\s\S]*?\}\s*\)/g)) {
				routes += 1
				const block = match[0]
				const method = /method:\s*'([A-Z]+)'/.exec(block)?.[1] ?? 'GET'
				const declaresBody = /(?:body|input|schema):/.test(block)

				if (!/^(?:POST|PUT|PATCH)$/.test(method) || declaresBody) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `${method} route declares no request schema — an unvalidated body fails deeper, where the error no longer names the input`,
					rule: 'CTL-2',
				})
			}
		}

		return conclude('route-schemas', violations, routes, 'route(s)')
	},
}

/**
 * `PRJ-3` — a shared artifact lives in `shared/`, not in the feature that
 * happened to need it first.
 *
 * The moment a second feature imports it, the first feature becomes a
 * dependency of the second for no reason anyone chose.
 */
export const sharedArtifactPlacement: Check = {
	id: 'shared-artifact-placement',
	rules: [
		'PRJ-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const features = context.files.filter(isFeature)
		const featureOf = (file: string) => /features\/([^/]+)\//.exec(file)?.[1]

		for (const file of features) {
			const owner = featureOf(file)
			const source = await context.read(file)

			for (const match of source.matchAll(/from '([^']+)'/g)) {
				const reached = /features\/([^/]+)\//.exec(
					resolveImport(file, match[1]),
				)

				if (!reached || reached[1] === owner) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `imports from feature '${reached[1]}' — what two features share belongs in shared/, or the dependency is one nobody chose`,
					rule: 'PRJ-3',
				})
			}
		}

		return conclude(
			'shared-artifact-placement',
			violations,
			features.length,
			'feature file(s)',
		)
	},
}

/**
 * `PRJ-4` — a module is registered once.
 *
 * Registered twice, the container has two instances of something written to be
 * one, and the bug it produces is intermittent by construction.
 */
export const singleRegistration: Check = {
	id: 'single-registration',
	rules: [
		'PRJ-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const modules = context.files.filter((file) => /\.module\.ts$/.test(file))
		const registrations = new Map<string, string[]>()

		for (const file of modules) {
			const source = await context.read(file)

			for (const match of source.matchAll(
				/(?:provide|register|bind)\(\s*([\w.]+)/g,
			)) {
				const token = match[1]
				registrations.set(token, [
					...(registrations.get(token) ?? []),
					file,
				])
			}
		}

		for (const [token, files] of registrations) {
			if (files.length < 2) {
				continue
			}

			violations.push({
				file: files[1],
				message: `${token} is registered in ${files.length} modules (${files.join(', ')}) — two instances of something written to be one`,
				rule: 'PRJ-4',
			})
		}

		return conclude(
			'single-registration',
			violations,
			modules.length,
			'module(s)',
		)
	},
}

/**
 * `PRJ-1` — the project extends the shared config instead of restating it.
 *
 * A restated config drifts the day the shared one gains a rule, and the drift
 * is invisible: both files are valid, they just no longer agree.
 */
export const configExtends: Check = {
	id: 'config-extends',
	rules: [
		'PRJ-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []

		// Only a package that *depends* on the shared config can extend it.
		// Without this the check fired on all thirty packages in the monorepo,
		// the config packages themselves included — a finding with no action
		// behind it, which is the kind that gets a gate switched off.
		const manifests = context.files.filter((file) =>
			/(?:^|\/)package\.json$/.test(file),
		)

		let consumes = false

		for (const file of manifests) {
			if (/@turystack\/[\w-]*config/.test(await context.read(file))) {
				consumes = true
				break
			}
		}

		const configs = consumes
			? context.files.filter((file) => /(?:^|\/)biome\.jsonc?$/.test(file))
			: []

		for (const file of configs) {
			const source = await context.read(file)

			if (/"extends"\s*:\s*\[[^\]]*@turystack\/[\w-]*config/.test(source)) {
				continue
			}

			violations.push({
				file,
				message:
					'does not extend @turystack/*-config — a restated config stops agreeing with the shared one the day it gains a rule',
				rule: 'PRJ-1',
			})
		}

		return conclude(
			'config-extends',
			violations,
			configs.length,
			'config file(s)',
		)
	},
}

/**
 * `REP-4` — a migration declares its phase and how it comes back.
 *
 * A migration with no `down` is a deploy with no way out, and the moment you
 * need one is the moment nobody has time to write it.
 */
export const migrationShape: Check = {
	id: 'migration-shape',
	rules: [
		'REP-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const migrations = context.files.filter((file) =>
			/migrations?\/.*\.ts$/.test(file),
		)

		for (const file of migrations) {
			const source = await context.read(file)

			if (!/\b(?:down|revert)\s*[(:=]/.test(source)) {
				violations.push({
					file,
					message:
						'declares no down/revert — a migration with no way back is a deploy with no way out',
					rule: 'REP-4',
				})
			}
		}

		return conclude(
			'migration-shape',
			violations,
			migrations.length,
			'migration(s)',
		)
	},
}

/**
 * `REP-6` — a soft-deleted row is excluded by the repository, not by the caller.
 *
 * Left to the caller it is excluded in the queries someone remembered and
 * present in the ones they did not, which is how deleted records reappear in
 * exports and reports.
 */
export const softDeleteFilter: Check = {
	id: 'soft-delete-filter',
	rules: [
		'REP-6',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const entities = context.files.filter((file) => /\.entity\.ts$/.test(file))
		const softDeleted: string[] = []

		for (const file of entities) {
			const source = await context.read(file)

			if (/\bdeletedAt\b/.test(source)) {
				softDeleted.push(file.replace(/\.entity\.ts$/, ''))
			}
		}

		for (const base of softDeleted) {
			const repository = `${base}.repository.ts`

			if (!context.files.includes(repository)) {
				continue
			}

			const source = await context.read(repository)

			if (/deletedAt/.test(source)) {
				continue
			}

			violations.push({
				file: repository,
				message:
					'the entity is soft-deleted and the repository never mentions deletedAt — the exclusion then lives in whichever caller remembered it',
				rule: 'REP-6',
			})
		}

		return conclude(
			'soft-delete-filter',
			violations,
			softDeleted.length,
			'soft-deleted entity(ies)',
		)
	},
}

export const BACKEND_STRUCTURE_CHECKS: Check[] = [
	adapterStructure,
	configExtends,
	entityDecorator,
	fileRoles,
	migrationShape,
	noBusinessVerbInRepo,
	routeSchemas,
	schemaMetadata,
	sharedArtifactPlacement,
	singleRegistration,
	softDeleteFilter,
	useCaseShape,
]
