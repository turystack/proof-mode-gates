import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { aside, scannable } from '@/checks/scope.js'

/**
 * What a test suite has to be true about itself.
 *
 * Coverage is a rung of its own and answers a different question. These checks
 * answer the one coverage cannot: whether the tests are at the level they claim
 * to be. A "unit" test that opens a database is slow, flaky and proves
 * integration; an "e2e" test against mocks proves the mocks.
 */

const isUnit = (file: string) =>
	/\.test\.tsx?$/.test(file) && !/\.(?:e2e|int)\./.test(file)
const isE2E = (file: string) => /\.e2e\.(?:test\.)?tsx?$/.test(file)
const isIntegration = (file: string) => /\.int\.(?:test\.)?tsx?$/.test(file)
const isAnyTest = (file: string) =>
	isUnit(file) || isE2E(file) || isIntegration(file)

const INFRA =
	/\b(?:PrismaClient|createConnection|new Pool|mongoose\.connect|createClient\(|Redis\(|testcontainers)\b/

/**
 * `ARC-TST-1` — a unit test touches no infrastructure.
 *
 * The reason is not purity. A unit test that reaches a database is the test
 * that fails in CI for reasons unrelated to the change, and a suite people
 * learn to re-run is a suite that no longer gates anything.
 */
export const unitNoInfra: Check = {
	id: 'unit-no-infra',
	rules: [
		'ARC-TST-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files: units } = await scannable(context, isUnit)

		for (const file of units) {
			const source = await context.read(file)
			const match = INFRA.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message: `${match[0]} in a unit test — this is the test that fails in CI for reasons unrelated to the change, and a suite people re-run gates nothing`,
				rule: 'ARC-TST-1',
			})
		}

		return conclude(
			'unit-no-infra',
			violations,
			units.length,
			'unit test(s)',
			aside(excluded),
		)
	},
}

/**
 * `TST-4` — an integration test exercises the seam, not the network.
 *
 * Reaching a third party makes the suite depend on someone else's uptime, and
 * a red build nobody can fix is a red build people start ignoring.
 */
export const integrationNoIo: Check = {
	id: 'integration-no-io',
	rules: [
		'TST-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files: tests } = await scannable(context, isIntegration)

		for (const file of tests) {
			const source = await context.read(file)
			const match = /\b(?:fetch|axios)\s*(?:\.\w+)?\(\s*[`'"]https?:\/\//.exec(
				source,
			)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					"reaches a real third party — the suite then depends on someone else's uptime, and a red build nobody can fix is one people ignore",
				rule: 'TST-4',
			})
		}

		return conclude(
			'integration-no-io',
			violations,
			tests.length,
			'integration test(s)',
			aside(excluded),
		)
	},
}

/**
 * `TST-5` — an e2e test runs against the real thing.
 *
 * An e2e suite with mocks in it proves the mocks agree with the test. That is a
 * tautology wearing the name of the most expensive tier in the pyramid.
 */
export const e2eNoMocks: Check = {
	id: 'e2e-no-mocks',
	rules: [
		'TST-5',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const tests = context.files.filter(isE2E)

		for (const file of tests) {
			const source = await context.read(file)
			const match =
				/\b(?:vi|jest)\.mock\(|mockResolvedValue|msw|setupServer\(/.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message: `${match[0]} in an e2e test — this proves the mocks agree with the test, which is a tautology wearing the name of the most expensive tier`,
				rule: 'TST-5',
			})
		}

		return conclude('e2e-no-mocks', violations, tests.length, 'e2e test(s)')
	},
}

/**
 * `ARC-TST-2` — the e2e tier runs against real infrastructure, declared once.
 *
 * Declared per test, each file brings up its own idea of the environment, and
 * the difference between them is where the flakiness comes from.
 */
export const e2eRealInfra: Check = {
	id: 'e2e-real-infra',
	rules: [
		'ARC-TST-2',
	],
	async run(context: CheckContext) {
		const tests = context.files.filter(isE2E)

		if (tests.length === 0) {
			return {
				id: 'e2e-real-infra',
				state: 'skipped',
				summary: 'no e2e test to inspect',
				violations: [],
			}
		}

		const declared = context.files.some((file) =>
			/(?:docker-compose|compose)\.(?:e2e\.)?ya?ml$|globalSetup|e2e\.setup\.ts$/.test(
				file,
			),
		)

		return declared
			? {
					id: 'e2e-real-infra',
					state: 'pass',
					summary: `${tests.length} e2e test(s) against a declared environment`,
					violations: [],
				}
			: {
					id: 'e2e-real-infra',
					state: 'fail',
					summary: `${tests.length} e2e test(s) with no declared environment`,
					violations: [
						{
							file: tests[0],
							message:
								'no compose file or global setup declares the infrastructure — each test then brings up its own idea of the environment, and the difference is the flakiness',
							rule: 'ARC-TST-2',
						},
					],
				}
	},
}

/**
 * `ARC-TST-4` — the tiers are configured separately.
 *
 * One config for everything means the slow tier's timeouts apply to the fast
 * one, and the fast one stops being fast enough to run on every save.
 */
export const testConfigSplit: Check = {
	id: 'test-config-split',
	rules: [
		'ARC-TST-4',
	],
	async run(context: CheckContext) {
		const configs = context.files.filter((file) =>
			/vitest[\w.]*\.config\.[cm]?[jt]s$/.test(file),
		)

		if (configs.length === 0) {
			return {
				id: 'test-config-split',
				state: 'skipped',
				summary: 'no vitest config found',
				violations: [],
			}
		}

		const hasE2E = configs.some((file) => /e2e/.test(file))
		const e2eTests = context.files.filter(isE2E)

		if (e2eTests.length === 0 || hasE2E) {
			return {
				id: 'test-config-split',
				state: 'pass',
				summary: `${configs.length} test config(s)`,
				violations: [],
			}
		}

		return {
			id: 'test-config-split',
			state: 'fail',
			summary: `${e2eTests.length} e2e test(s) share the default config`,
			violations: [
				{
					file: configs[0],
					message:
						"no vitest.e2e.config — one config for every tier applies the slow tier's timeouts to the fast one, and the fast one stops running on every save",
					rule: 'ARC-TST-4',
				},
			],
		}
	},
}

/**
 * `ARC-TST-7` — a suite fails loudly rather than reporting on nothing.
 *
 * `passWithNoTests` turns a deleted file into a green build. It is the single
 * flag most likely to make a whole rung meaningless.
 */
export const failLoud: Check = {
	id: 'fail-loud',
	rules: [
		'ARC-TST-7',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const configs = context.files.filter((file) =>
			/vitest[\w.]*\.config\.[cm]?[jt]s$|vitest\.base\.[cm]?js$/.test(file),
		)

		for (const file of configs) {
			const source = await context.read(file)
			const match = /passWithNoTests\s*:\s*true/.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'passWithNoTests: true turns a deleted test file into a green build — it is the single flag most able to make a rung report on nothing',
				rule: 'ARC-TST-7',
			})
		}

		return conclude('fail-loud', violations, configs.length, 'test config(s)')
	},
}

/**
 * `TST-1` — the tests sit beside what they test.
 *
 * A parallel `__tests__` tree means a moved file leaves its test behind, and a
 * test nobody can find beside its subject is a test nobody updates.
 */
export const testFilePlacement: Check = {
	id: 'test-file-placement',
	rules: [
		'TST-L1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const tests = context.files.filter(isAnyTest)

		for (const file of tests) {
			if (!/(?:^|\/)(?:__tests__|tests?)\//.test(file)) {
				continue
			}

			// A suite outside `src/` tests the package, not a module — there is no
			// file for it to sit beside, so the law has nothing to say about it.
			if (!file.startsWith('src/')) {
				continue
			}

			violations.push({
				file,
				message:
					'lives in a parallel test tree — a moved file then leaves its test behind, and a test that is not beside its subject is one nobody updates',
				rule: 'TST-L1',
			})
		}

		return conclude(
			'test-file-placement',
			violations,
			tests.length,
			'test file(s)',
		)
	},
}

/**
 * `ARC-TST-3` — every tier the project claims actually exists.
 *
 * A pyramid with a missing tier is a pyramid where the missing tier's failures
 * are found by users.
 *
 * A tier is required when the project has something that tier is the only way
 * to prove. A pure library — parsers, helpers, a rule engine — is fully covered
 * by unit tests, and demanding an e2e suite of it produces a red that the only
 * available fix is a fake test. The seam has to exist before "you have not
 * tested the seam" is a sentence that means anything.
 */
const NEEDS_INTEGRATION = /\.(?:repository|adapter|client|gateway)\.ts$/
const NEEDS_E2E =
	/\.(?:controller|handler|subscriber)\.ts$|(?:^|\/)routes?\/.+\.tsx$/

export const testLevels: Check = {
	id: 'test-levels',
	rules: [
		'ARC-TST-3',
	],
	async run(context: CheckContext) {
		const units = context.files.filter(isUnit)
		const integrations = context.files.filter(isIntegration)
		const e2e = context.files.filter(isE2E)
		const total = units.length + integrations.length + e2e.length

		if (total === 0) {
			return {
				id: 'test-levels',
				state: 'skipped',
				summary: 'no test to inspect',
				violations: [],
			}
		}

		const hasSeams = context.files.some((file) => NEEDS_INTEGRATION.test(file))
		const hasEntryPoints = context.files.some((file) => NEEDS_E2E.test(file))

		const missing = [
			units.length === 0 && 'unit',
			hasSeams && integrations.length === 0 && 'integration',
			hasEntryPoints && e2e.length === 0 && 'e2e',
		].filter(Boolean) as string[]

		return {
			id: 'test-levels',
			state: missing.length > 0 ? 'fail' : 'pass',
			summary: `${units.length} unit · ${integrations.length} integration · ${e2e.length} e2e`,
			violations: missing.map((tier) => ({
				file: '.',
				message: `no ${tier} test in the project — the failures that tier would catch are found by users instead`,
				rule: 'ARC-TST-3',
			})),
		}
	},
}

/**
 * `TST-6` — a controller has an e2e test.
 *
 * The controller is the only place where routing, validation, auth and the
 * envelope meet. Unit tests cover each of them and none of them together.
 */
function coverageOf(spec: {
	id: string
	rule: string
	suffix: string
	what: string
	why: string
}): Check {
	const { id, rule, suffix, what, why } = spec

	return {
		id,
		rules: [
			rule,
		],
		async run(context: CheckContext) {
			const subjects = context.files.filter((file) => file.endsWith(suffix))
			const violations: Violation[] = []

			for (const file of subjects) {
				const base = file.slice(0, -suffix.length)
				const covered = context.files.some(
					(candidate) => candidate.startsWith(base) && isE2E(candidate),
				)

				if (covered) {
					continue
				}

				violations.push({
					file,
					message: `no e2e test beside this ${what} — ${why}`,
					rule,
				})
			}

			return conclude(id, violations, subjects.length, `${what}(s)`)
		},
	}
}

export const controllerE2E = coverageOf({
	id: 'controller-e2e',
	rule: 'TST-6',
	suffix: '.controller.ts',
	what: 'controller',
	why: 'the controller is the only place routing, validation, auth and the envelope meet, and unit tests cover each of them separately',
})

export const handlerE2E = coverageOf({
	id: 'handler-e2e',
	rule: 'TST-7',
	suffix: '.handler.ts',
	what: 'handler',
	why: 'a handler is reached only by a real message, so nothing below e2e proves it is wired to one',
})

/**
 * `TST-8` / `FE-TST-3` — setup is shared, not restated per file.
 *
 * Restated, the files drift, and the difference between two setups is where a
 * test that passes alone and fails in the suite comes from.
 *
 * The law is about setup that exists. A suite of pure assertions has none to
 * share, and requiring a setup module of it asks for an empty file whose only
 * purpose is to satisfy this check — which is the definition of a gate teaching
 * people to work around it rather than with it. So the count is of files that
 * actually set something up.
 */
const DOES_SETUP =
	/\b(?:beforeEach|beforeAll|afterEach|afterAll)\s*\(|\b(?:vi|jest)\.mock\s*\(|\brender\s*\(/

function sharedSetupCheck(spec: {
	id: string
	rule: string
	pick: (file: string) => boolean
}): Check {
	const { id, rule, pick } = spec

	return {
		id,
		rules: [
			rule,
		],
		async run(context: CheckContext) {
			const candidates = context.files.filter(pick)
			const shared = context.files.some((file) =>
				/(?:test|vitest)[\w.-]*setup\.[cm]?tsx?$|test-utils?\.[cm]?tsx?$/.test(
					file,
				),
			)

			const tests: string[] = []

			for (const file of candidates) {
				if (DOES_SETUP.test(await context.read(file))) {
					tests.push(file)
				}
			}

			if (tests.length < 2) {
				return {
					id,
					state: 'skipped' as const,
					summary:
						candidates.length < 2
							? 'fewer than two test files'
							: `${candidates.length} test file(s), fewer than two with setup to share`,
					violations: [],
				}
			}

			if (shared) {
				return {
					id,
					state: 'pass' as const,
					summary: `${tests.length} test file(s) over a shared setup`,
					violations: [],
				}
			}

			return {
				id,
				state: 'fail' as const,
				summary: `${tests.length} test file(s), no shared setup`,
				violations: [
					{
						file: tests[0],
						message:
							'no shared setup module — restated setup drifts between files, and the difference is where a test that passes alone and fails in the suite comes from',
						rule,
					},
				],
			}
		},
	}
}

export const sharedSetup = sharedSetupCheck({
	id: 'shared-setup',
	pick: isAnyTest,
	rule: 'TST-8',
})

export const sharedHarness = sharedSetupCheck({
	id: 'shared-harness',
	pick: (file) => /\.test\.tsx$/.test(file),
	rule: 'FE-TST-3',
})

/**
 * `FE-TST-2` — mocks stop at the SDK boundary.
 *
 * Mocking below it — the fetch, the transport — means the test asserts on the
 * shape of the network call rather than on behaviour, and it breaks on every
 * regeneration for no reason a reader can act on.
 */
export const mockBoundary: Check = {
	id: 'mock-boundary',
	rules: [
		'FE-TST-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files: tests } = await scannable(context, (file) =>
			/\.test\.tsx?$/.test(file),
		)

		for (const file of tests) {
			const source = await context.read(file)
			const match =
				/(?:vi|jest)\.(?:mock|spyOn)\(\s*(?:global\s*,\s*)?['"]?(?:global\.)?fetch/.exec(
					source,
				)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'mocks fetch rather than the SDK — the test then asserts on the shape of the network call and breaks on every regeneration',
				rule: 'FE-TST-2',
			})
		}

		return conclude(
			'mock-boundary',
			violations,
			tests.length,
			'test file(s)',
			aside(excluded),
		)
	},
}

/**
 * `FE-TST-1` — every screen has at least a render test.
 *
 * It is the cheapest test there is and it catches the most common frontend
 * break: a component that throws on mount because a provider is missing.
 */
export const renderSmoke: Check = {
	id: 'render-smoke',
	rules: [
		'FE-TST-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const screens = context.files.filter((file) =>
			/\.(?:page|screen|route)\.tsx$/.test(file),
		)

		for (const file of screens) {
			const test = file.replace(/\.tsx$/, '.test.tsx')

			if (context.files.includes(test)) {
				continue
			}

			violations.push({
				file,
				message:
					'no render test — the cheapest test there is, and the one that catches a component throwing on mount because a provider is missing',
				rule: 'FE-TST-1',
			})
		}

		return conclude('render-smoke', violations, screens.length, 'screen(s)')
	},
}

/**
 * `TST-3` — a pure helper is tested directly.
 *
 * Reached only through a component, its edge cases are tested by accident, and
 * the one that matters is the one no screen happens to exercise.
 */
export const utilTested: Check = {
	id: 'util-tested',
	rules: [
		'TST-5',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const utils = context.files.filter(
			(file) =>
				/\.(?:utils?|helpers?)\.ts$/.test(file) && !/\.test\./.test(file),
		)

		for (const file of utils) {
			const test = file.replace(/\.ts$/, '.test.ts')

			if (context.files.includes(test)) {
				continue
			}

			violations.push({
				file,
				message:
					'no test beside it — reached only through a component, its edge cases are tested by accident and the one that matters is the one no screen exercises',
				rule: 'TST-5',
			})
		}

		return conclude('util-tested', violations, utils.length, 'helper(s)')
	},
}

/**
 * `STO-1` / `STO-2` — a primitive ships stories, beside it.
 *
 * The story is the only artifact that shows every state at once. Without it,
 * "does the disabled variant still look right" is answered by opening the app
 * and finding a screen that happens to use it.
 */
export const storyPlacement: Check = {
	id: 'story-placement',
	rules: [
		'STB-L1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const stories = context.files.filter((file) =>
			/\.stories\.tsx?$/.test(file),
		)

		for (const file of stories) {
			const component = file.replace(/\.stories\.tsx?$/, '.tsx')

			if (context.files.includes(component)) {
				continue
			}

			violations.push({
				file,
				message:
					'no component beside this story — a story in a parallel tree is one that stops matching the component nobody remembered to move it with',
				rule: 'STB-L1',
			})
		}

		return conclude('story-placement', violations, stories.length, 'story(ies)')
	},
}

export const storyCoverage: Check = {
	id: 'story-coverage',
	rules: [
		'STB-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const primitives = context.files.filter(
			(file) =>
				/(?:^|\/)components\/[^/]+\/[^/]+\.tsx$/.test(file) &&
				!/\.(?:test|stories|styles|context|types)\.tsx?$/.test(file),
		)

		for (const file of primitives) {
			const story = file.replace(/\.tsx$/, '.stories.tsx')

			if (context.files.includes(story)) {
				continue
			}

			violations.push({
				file,
				message:
					'no story — the story is the only artifact that shows every state at once, so without it a variant is checked by finding a screen that happens to use it',
				rule: 'STB-1',
			})
		}

		return conclude(
			'story-coverage',
			violations,
			primitives.length,
			'primitive(s)',
		)
	},
}

export const TESTING_CHECKS: Check[] = [
	controllerE2E,
	e2eNoMocks,
	e2eRealInfra,
	failLoud,
	handlerE2E,
	integrationNoIo,
	mockBoundary,
	renderSmoke,
	sharedHarness,
	sharedSetup,
	storyCoverage,
	storyPlacement,
	testConfigSplit,
	testFilePlacement,
	testLevels,
	unitNoInfra,
	utilTested,
]
