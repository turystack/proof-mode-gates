import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { GateReport } from '@/report.js'
import { emit, summaryLine, verdictOf } from '@/report.js'

const base: GateReport = {
	ladder: [
		{
			command: 'biome check .',
			id: 'lint',
			name: 'Lint',
			proves: '',
			result: '0',
			state: 'pass',
		},
	],
	provenance: {},
	schema: 'turystack.gate-report/1',
	task: {},
}

describe('the verdict is computed, never declared', () => {
	it('is green when every rung is green and nothing is missing', () => {
		expect(verdictOf(base)).toBe('pass')
	})

	it('ignores a payload that declares itself green', () => {
		const lying = {
			...base,
			ladder: [
				{
					...base.ladder[0],
					state: 'fail' as const,
				},
			],
			verdict: 'pass',
		}

		expect(verdictOf(lying)).toBe('fail')
	})

	it('fails on a required capture that never arrived', () => {
		const report = {
			...base,
			frontend: {
				screens: [
					{
						captures: [
							{
								image: null,
								state: 'denied',
							},
						],
						required: [
							'denied',
						],
					},
				],
			},
		}

		expect(verdictOf(report)).toBe('fail')
	})

	it('passes once that capture exists', () => {
		const report = {
			...base,
			frontend: {
				screens: [
					{
						captures: [
							{
								image: 'denied.png',
								state: 'denied',
							},
						],
						required: [
							'denied',
						],
					},
				],
			},
		}

		expect(verdictOf(report)).toBe('pass')
	})

	it('fails on a red structural check', () => {
		const report = {
			...base,
			structure: [
				{
					id: 'route-shape',
					state: 'fail' as const,
					summary: '',
					violations: [],
				},
			],
		}

		expect(verdictOf(report)).toBe('fail')
	})

	it('does not fail on a pending check, but says how many there are', () => {
		const report = {
			...base,
			structure: [
				{
					id: 'acl-coverage',
					state: 'pending' as const,
					summary: '',
					violations: [],
				},
			],
		}

		expect(verdictOf(report)).toBe('pass')
		expect(summaryLine(report)).toContain('1 check(s) not implemented')
	})
})

/**
 * `inconclusive` — the state that used to be `pass`.
 *
 * `turystack-proof report` outside a git repository produced an empty ladder
 * and ninety-three `skipped` checks, and the verdict said `pass`. Nothing had
 * failed because nothing had run.
 */
describe('nothing ran is not nothing failed @empty-run', () => {
	it('refuses to pass a report with an empty ladder and no conclusion', () => {
		expect(
			verdictOf({
				ladder: [],
				provenance: {},
				schema: 'turystack.gate-report/1',
				structure: [
					{
						id: 'route-shape',
						state: 'skipped',
						summary: '',
						violations: [],
					},
					{
						id: 'acl-coverage',
						state: 'skipped',
						summary: '',
						violations: [],
					},
				],
				task: {},
			}),
		).toBe('inconclusive')
	})

	it('passes as soon as one check actually concluded', () => {
		expect(
			verdictOf({
				ladder: [],
				provenance: {},
				schema: 'turystack.gate-report/1',
				structure: [
					{
						id: 'route-shape',
						state: 'pass',
						summary: '',
						violations: [],
					},
					{
						id: 'acl-coverage',
						state: 'skipped',
						summary: '',
						violations: [],
					},
				],
				task: {},
			}),
		).toBe('pass')
	})

	it('still fails over inconclusive when something is red', () => {
		expect(
			verdictOf({
				ladder: [],
				provenance: {},
				schema: 'turystack.gate-report/1',
				structure: [
					{
						id: 'route-shape',
						state: 'fail',
						summary: '',
						violations: [],
					},
				],
				task: {},
			}),
		).toBe('fail')
	})

	it('says so in the one line a feed reads', () => {
		expect(
			summaryLine({
				ladder: [],
				provenance: {},
				schema: 'turystack.gate-report/1',
				structure: [],
				task: {},
			}),
		).toContain('nothing ran')
	})
})

describe('the report keeps the evidence the runner did not produce', () => {
	const runnerOutput: GateReport = {
		ladder: [
			{
				command: 'biome check .',
				id: 'lint',
				name: 'Lint',
				proves: '',
				result: '0',
				state: 'pass',
			},
		],
		provenance: {
			runner: '@turystack/proof-mode-gates',
		},
		schema: 'turystack.gate-report/1',
		task: {
			finishedAt: '2026-08-25T12:00:00.000Z',
		},
	}

	const authored = {
		backend: {
			specs: [
				{
					spec: 'AC-1 a delivered order refuses',
					test: 'cancel-order.test.ts',
				},
			],
		},
		contractDelta: [],
		ladder: [],
		provenance: {
			runner: 'somebody else',
		},
		schema: 'turystack.gate-report/1',
		task: {
			covers: [
				'AC-1',
			],
			id: 'T-4',
		},
		verdict: 'pass',
	}

	async function emitOver(
		existing: unknown,
		options?: {
			merge?: boolean
		},
	) {
		const directory = await mkdtemp(join(tmpdir(), 'report-'))

		if (existing !== undefined) {
			await writeFile(
				join(directory, 'gate-report.json'),
				JSON.stringify(existing),
				'utf8',
			)
		}

		const written = await emit(runnerOutput, directory, options)

		return {
			payload: JSON.parse(await readFile(written.json, 'utf8')),
			written,
		}
	}

	it('keeps the blocks it has nothing truer to put in place of', async () => {
		const { payload, written } = await emitOver(authored)

		expect(payload.backend.specs).toHaveLength(1)
		expect(payload.task.id).toBe('T-4')
		expect(payload.task.covers).toEqual([
			'AC-1',
		])
		expect(written.merged).toContain('backend')
	})

	it('wins on everything it computed, including the task block it stamped', async () => {
		const { payload } = await emitOver(authored)

		expect(payload.ladder).toHaveLength(1)
		expect(payload.provenance.runner).toBe('@turystack/proof-mode-gates')
		expect(payload.task.finishedAt).toBe('2026-08-25T12:00:00.000Z')
	})

	it('never carries a verdict across — it recomputes one', async () => {
		const { payload } = await emitOver({
			...authored,
			ladder: [],
			verdict: 'pass',
		})

		// The merged object has one green rung, so this is earned rather than
		// inherited; the point is that the key was recomputed, not preserved.
		expect(payload.verdict).toBe(verdictOf(runnerOutput))
	})

	it('ignores a file that is not one of ours', async () => {
		const { payload, written } = await emitOver({
			schema: 'some.other.thing/1',
			secrets: 'do not adopt me',
		})

		expect(payload.secrets).toBeUndefined()
		expect(written.merged).toEqual([])
	})

	it('overwrites outright when asked to', async () => {
		const { payload, written } = await emitOver(authored, {
			merge: false,
		})

		expect(payload.backend).toBeUndefined()
		expect(written.merged).toEqual([])
	})

	it('returns the payload it wrote, so a caller cannot report a stale verdict', async () => {
		// The runner's own object has one green rung and no screens: `pass`. The
		// report on disk carries a screen whose required capture never arrived,
		// which is a `fail`. A caller reading the verdict off the object it
		// assembled would print green over a red artifact.
		const { payload, written } = await emitOver({
			...authored,
			frontend: {
				screens: [
					{
						captures: [
							{
								image: null,
								state: 'denied',
							},
						],
						required: [
							'denied',
						],
					},
				],
			},
		})

		expect(verdictOf(runnerOutput)).toBe('pass')
		expect(verdictOf(written.payload)).toBe('fail')
		expect(payload.verdict).toBe('fail')
	})

	it('writes a fresh report when there is nothing there', async () => {
		const { payload, written } = await emitOver(undefined)

		expect(payload.schema).toBe('turystack.gate-report/1')
		expect(written.merged).toEqual([])
	})
})
