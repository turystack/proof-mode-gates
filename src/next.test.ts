import { describe, expect, it } from 'vitest'

import { LEDGER_FILE, next } from '@/next.js'
import {
	fingerprint,
	hashOf,
	hashOfAll,
	specHashes,
	specHashesFor,
} from '@/spec-hash.js'
import type { CheckContext } from '@/types.js'

type Project = Record<string, string>

function contextOf(files: Project): CheckContext {
	return {
		changed: Object.keys(files),
		cwd: '/virtual',
		files: Object.keys(files),
		async read(file: string) {
			return files[file] ?? ''
		},
	}
}

const SPEC = '.claude/skills/acme-spec/04-rules.md'
const BOARD = '.claude/skills/acme-spec/board/tasks.json'
const REPORT = '.claude/skills/acme-spec/board/reports/t-4.json'
const LEDGER = `.claude/skills/acme-spec/board/${LEDGER_FILE}`
const NOW = new Date('2026-08-25T12:00:00.000Z')

/**
 * A spec with both halves.
 *
 * The Shape half carries example ids on purpose: they are what a materialized
 * skill ships with, and reading them as the project's own decisions is the
 * mistake `projectHalf` exists to prevent.
 */
function spec(rules: string[]): string {
	return [
		'## Shape',
		'',
		'| AC-99 | the example the template ships |',
		'',
		'## acme',
		'',
		...rules,
		'',
	].join('\n')
}

function board(tasks: unknown[]): string {
	return JSON.stringify({
		project: 'acme',
		tasks,
	})
}

const RULES = [
	'| AC-1 | a delivered order refuses cancellation |',
	'| AC-2 | a pending order cancels |',
]

describe('T1 · a decision carries a digest of what it says', () => {
	it('is short, and stable for the same text', () => {
		expect(fingerprint('a', 'b')).toHaveLength(12)
		expect(fingerprint('a', 'b')).toBe(fingerprint('a', 'b'))
	})

	it('separates the parts, so two joinings are not one digest', () => {
		expect(fingerprint('a', 'b')).not.toBe(fingerprint('ab'))
	})

	it('digests one declaration from its lines, and nothing else about it', () => {
		const lines = [
			'| AC-1 | a delivered order refuses cancellation |',
		]

		// The file a declaration was found in is not part of what it says: moving
		// a decision between two spec sections must not read as rewording it.
		expect(
			hashOf({
				file: 'one.md',
				lines,
			}),
		).toBe(
			hashOf({
				file: 'another.md',
				lines,
			}),
		)
		expect(
			hashOf({
				file: 'one.md',
				lines,
			}),
		).toBe(fingerprint(...lines))
	})

	it('digests a whole claim from the parts, in the order it was given', () => {
		expect(
			hashOfAll([
				'a',
				'b',
			]),
		).toBe(fingerprint('a', 'b'))
		expect(
			hashOfAll([
				'b',
				'a',
			]),
		).not.toBe(
			hashOfAll([
				'a',
				'b',
			]),
		)
	})

	it('gives a task the digest of the decisions it claims', async () => {
		const files = {
			[BOARD]: board([
				{
					casesApprovedBy: 'ana',
					covers: [
						'AC-1',
						'AC-2',
					],
					id: 'T-1',
					status: 'todo',
				},
			]),
			[SPEC]: spec(RULES),
		}
		const hashes = await specHashes(contextOf(files))
		const rows = await next(contextOf(files))

		expect(rows[0].contentHash).toBe(
			hashOfAll([
				hashes.get('AC-1') ?? '',
				hashes.get('AC-2') ?? '',
			]),
		)
	})

	it('digests the ids the project declared, not the ones the template shows', async () => {
		const hashes = await specHashes(
			contextOf({
				[SPEC]: spec(RULES),
			}),
		)

		expect([
			...hashes.keys(),
		]).toEqual([
			'AC-1',
			'AC-2',
		])
	})

	it('moves when the decision is reworded, and only then', async () => {
		const before = await specHashes(
			contextOf({
				[SPEC]: spec(RULES),
			}),
		)
		const untouched = await specHashes(
			contextOf({
				[SPEC]: `${spec(RULES)}\n\nsome prose nobody indexed\n`,
			}),
		)
		const reworded = await specHashes(
			contextOf({
				[SPEC]: spec([
					'| AC-1 | a delivered order refuses, and says to return it |',
					RULES[1],
				]),
			}),
		)

		expect(untouched.get('AC-1')).toBe(before.get('AC-1'))
		expect(reworded.get('AC-1')).not.toBe(before.get('AC-1'))
		expect(reworded.get('AC-2')).toBe(before.get('AC-2'))
	})

	it('takes the prose under a heading, not just the line naming the id', async () => {
		const heading = (closing: string) =>
			[
				'## acme',
				'',
				'### AC-4',
				'',
				'A delivered order refuses cancellation.',
				closing,
				'',
				'### AC-5',
				'',
				'A pending order cancels.',
				'',
			].join('\n')

		const before = await specHashes(
			contextOf({
				[SPEC]: heading('The message names return.'),
			}),
		)
		const after = await specHashes(
			contextOf({
				[SPEC]: heading('The message names refund.'),
			}),
		)

		// The line naming AC-4 never changed. Hashing only that line would call
		// this proved, which is the failure the block unit exists to prevent.
		expect(after.get('AC-4')).not.toBe(before.get('AC-4'))
		expect(after.get('AC-5')).toBe(before.get('AC-5'))
	})

	it('stops one decision at the next, so a table row is its own block', async () => {
		const before = await specHashes(
			contextOf({
				[SPEC]: spec(RULES),
			}),
		)
		const after = await specHashes(
			contextOf({
				[SPEC]: spec([
					RULES[0],
					'| AC-2 | a pending order cancels, and refunds |',
				]),
			}),
		)

		expect(after.get('AC-1')).toBe(before.get('AC-1'))
		expect(after.get('AC-2')).not.toBe(before.get('AC-2'))
	})

	it('collects the id from every file that names it', async () => {
		const alone = await specHashes(
			contextOf({
				[SPEC]: spec(RULES),
			}),
		)
		const restated = await specHashes(
			contextOf({
				'.claude/skills/acme-uiux/05-copy.md': spec([
					'AC-1 is the message on the Orders table',
				]),
				[SPEC]: spec(RULES),
			}),
		)

		expect(restated.get('AC-1')).not.toBe(alone.get('AC-1'))
	})

	it('omits a claimed id the spec never declared, rather than digesting nothing', async () => {
		const claimed = await specHashesFor(
			contextOf({
				[SPEC]: spec(RULES),
			}),
			[
				'AC-1',
				'AC-404',
			],
		)

		expect(Object.keys(claimed)).toEqual([
			'AC-1',
		])
	})
})

describe('T2 · what is open is derived, not remembered', () => {
	it('has nothing to select from without a board', async () => {
		expect(
			await next(
				contextOf({
					[SPEC]: spec(RULES),
				}),
			),
		).toEqual([])
	})

	it('names a declared id no task schedules', async () => {
		const rows = await next(
			contextOf({
				[BOARD]: board([
					{
						casesApprovedBy: 'ana',
						covers: [
							'AC-1',
						],
						id: 'T-1',
						status: 'todo',
					},
				]),
				[SPEC]: spec(RULES),
			}),
		)

		expect(rows[0]).toMatchObject({
			actionable: true,
			key: 'AC-2',
			kind: 'uncovered',
		})
	})

	it('offers a task whose cases a person approved', async () => {
		const rows = await next(
			contextOf({
				[BOARD]: board([
					{
						casesApprovedBy: 'ana',
						covers: [
							'AC-1',
							'AC-2',
						],
						id: 'T-1',
						status: 'todo',
					},
				]),
				[SPEC]: spec(RULES),
			}),
		)

		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			actionable: true,
			key: 'T-1',
			kind: 'ready',
		})
		expect(rows[0].evidence).toContain('ana')
	})

	it('holds back a task nobody approved, and one already in flight', async () => {
		const rows = await next(
			contextOf({
				[BOARD]: board([
					{
						covers: [
							'AC-1',
						],
						id: 'T-1',
						status: 'todo',
					},
					{
						casesApprovedBy: 'ana',
						covers: [
							'AC-2',
						],
						id: 'T-2',
						status: 'doing',
					},
				]),
				[SPEC]: spec(RULES),
			}),
		)

		expect(rows.map((row) => row.actionable)).toEqual([
			false,
			false,
		])
		expect(rows.every((row) => row.kind === 'waiting')).toBe(true)
		expect(rows[0].evidence).toContain('cases')
		expect(rows[1].evidence).toContain('doing')
	})

	const done = (report: string | null) => [
		{
			casesApprovedBy: 'ana',
			covers: [
				'AC-1',
				'AC-2',
			],
			id: 'T-4',
			report,
			status: 'done',
		},
	]

	it('says nothing about a proved task whose decisions have not moved', async () => {
		const files = {
			[BOARD]: board(done('reports/t-4.json')),
			[SPEC]: spec(RULES),
		}
		const hashes = await specHashes(contextOf(files))

		const rows = await next(
			contextOf({
				...files,
				[REPORT]: JSON.stringify({
					task: {
						specHash: {
							'AC-1': hashes.get('AC-1'),
							'AC-2': hashes.get('AC-2'),
						},
					},
				}),
			}),
		)

		expect(rows).toEqual([])
	})

	it('flags the proved task whose decision was reworded afterwards', async () => {
		const before = await specHashes(
			contextOf({
				[SPEC]: spec(RULES),
			}),
		)

		const rows = await next(
			contextOf({
				[BOARD]: board(done('reports/t-4.json')),
				[REPORT]: JSON.stringify({
					task: {
						specHash: {
							'AC-1': before.get('AC-1'),
							'AC-2': before.get('AC-2'),
						},
					},
				}),
				[SPEC]: spec([
					'| AC-1 | a delivered order refuses, and says to return it |',
					RULES[1],
				]),
			}),
		)

		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			actionable: true,
			key: 'T-4',
			kind: 'stale',
		})
		expect(rows[0].evidence).toContain('AC-1')
		expect(rows[0].evidence).not.toContain('AC-2')
	})

	it('refuses to call a report fresh when it recorded no digest', async () => {
		const rows = await next(
			contextOf({
				[BOARD]: board(done('reports/t-4.json')),
				[REPORT]: JSON.stringify({
					task: {
						covers: [
							'AC-1',
						],
					},
				}),
				[SPEC]: spec(RULES),
			}),
		)

		expect(rows[0]).toMatchObject({
			actionable: false,
			key: 'T-4',
			kind: 'unproven',
		})
		expect(rows[0].evidence).toContain('AC-1')
	})

	it('says so when the report a done task points at cannot be read', async () => {
		const missing = await next(
			contextOf({
				[BOARD]: board(done('reports/t-4.json')),
				[SPEC]: spec(RULES),
			}),
		)
		const unnamed = await next(
			contextOf({
				[BOARD]: board(done(null)),
				[SPEC]: spec(RULES),
			}),
		)
		const broken = await next(
			contextOf({
				[BOARD]: board(done('reports/t-4.json')),
				[REPORT]: '{ not json',
				[SPEC]: spec(RULES),
			}),
		)

		for (const rows of [
			missing,
			unnamed,
			broken,
		]) {
			expect(rows[0]).toMatchObject({
				actionable: false,
				kind: 'unproven',
			})
		}
	})

	it('puts what can be picked up above what cannot', async () => {
		const rows = await next(
			contextOf({
				[BOARD]: board([
					{
						covers: [
							'AC-2',
						],
						id: 'T-2',
						status: 'todo',
					},
					{
						casesApprovedBy: 'ana',
						covers: [
							'AC-1',
						],
						id: 'T-1',
						status: 'todo',
					},
				]),
				[SPEC]: spec([
					...RULES,
					'| RULE-9 | refunds are manual |',
				]),
			}),
		)

		expect(rows.map((row) => row.kind)).toEqual([
			'uncovered',
			'ready',
			'waiting',
		])
		expect(rows[0].key).toBe('RULE-9')
	})

	it('falls back to a label when a task carries no id', async () => {
		const rows = await next(
			contextOf({
				[BOARD]: board([
					{
						covers: [
							'AC-1',
							'AC-2',
						],
						title: 'cancel an order',
					},
				]),
				[SPEC]: spec(RULES),
			}),
		)

		expect(rows[0].key).toBe('cancel an order')
	})
})

describe('T3 · a task that keeps failing stops being offered', () => {
	const ready = (extra: Record<string, unknown> = {}) => ({
		[BOARD]: board([
			{
				casesApprovedBy: 'ana',
				covers: [
					'AC-1',
					'AC-2',
				],
				id: 'T-1',
				status: 'todo',
			},
		]),
		[SPEC]: spec(RULES),
		...extra,
	})

	const ledger = (failCount: number, failedAt: Date) =>
		JSON.stringify({
			'T-1': {
				failCount,
				failedAt: failedAt.toISOString(),
				failedOn: 'typecheck',
				firstSeen: failedAt.toISOString(),
				lastSeen: failedAt.toISOString(),
			},
		})

	it('still offers a task that has failed once, and says so', async () => {
		const rows = await next(
			contextOf(
				ready({
					[LEDGER]: ledger(1, NOW),
				}),
			),
			{
				now: NOW,
			},
		)

		expect(rows[0]).toMatchObject({
			actionable: true,
			kind: 'ready',
		})
		expect(rows[0].evidence).toContain('1 failed run(s)')
		expect(rows[0].evidence).toContain('typecheck')
	})

	it('holds back a task in backoff, and says when it comes back', async () => {
		const rows = await next(
			contextOf(
				ready({
					[LEDGER]: ledger(3, NOW),
				}),
			),
			{
				now: NOW,
			},
		)

		expect(rows[0]).toMatchObject({
			actionable: false,
			kind: 'waiting',
		})
		expect(rows[0].evidence).toContain('backing off until')
	})

	it('offers it again once the cooldown has passed', async () => {
		const rows = await next(
			contextOf(
				ready({
					[LEDGER]: ledger(3, new Date(NOW.getTime() - 7 * 3_600_000)),
				}),
			),
			{
				now: NOW,
			},
		)

		expect(rows[0]).toMatchObject({
			actionable: true,
			kind: 'ready',
		})
	})

	it('reads a broken ledger as no history rather than as no work', async () => {
		const rows = await next(
			contextOf(
				ready({
					[LEDGER]: '{ not json',
				}),
			),
			{
				now: NOW,
			},
		)

		expect(rows[0]).toMatchObject({
			actionable: true,
			kind: 'ready',
		})
		expect(rows[0].evidence).not.toContain('failed run')
	})
})
