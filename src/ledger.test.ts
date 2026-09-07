import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Ledger } from '@/ledger.js'
import {
	BACKOFF_AFTER,
	BACKOFF_HOURS,
	inBackoff,
	load,
	mark,
	PRUNE_DAYS,
	prune,
	recordFailure,
	retriesAt,
	save,
} from '@/ledger.js'

const NOW = new Date('2026-08-25T12:00:00.000Z')

function ago(hours: number): Date {
	return new Date(NOW.getTime() - hours * 3_600_000)
}

function failed(times: number, at: Date): Ledger {
	const ledger: Ledger = {}

	for (let n = 0; n < times; n += 1) {
		recordFailure(
			ledger,
			'T-4',
			{
				rung: 'typecheck',
			},
			at,
		)
	}

	return ledger
}

describe('T3 · red survives the session', () => {
	it('counts failures and remembers which rung went red', () => {
		const ledger = failed(2, NOW)

		expect(ledger['T-4']).toMatchObject({
			failCount: 2,
			failedOn: 'typecheck',
		})
	})

	it('leaves a task alone once it has failed enough, recently enough', () => {
		expect(inBackoff(failed(BACKOFF_AFTER - 1, NOW)['T-4'], NOW)).toBe(false)
		expect(inBackoff(failed(BACKOFF_AFTER, NOW)['T-4'], NOW)).toBe(true)
	})

	it('offers it again once the cooldown is over', () => {
		const cold = failed(BACKOFF_AFTER, ago(BACKOFF_HOURS + 1))

		expect(inBackoff(cold['T-4'], NOW)).toBe(false)
	})

	it('says when a backed-off task comes back', () => {
		const ledger = failed(BACKOFF_AFTER, NOW)

		expect(retriesAt(ledger['T-4'])).toBe(
			new Date(NOW.getTime() + BACKOFF_HOURS * 3_600_000).toISOString(),
		)
		expect(retriesAt(undefined)).toBeUndefined()
	})

	it('treats an entry with an unreadable timestamp as out of backoff', () => {
		const ledger = failed(BACKOFF_AFTER, NOW)
		ledger['T-4'].failedAt = 'sometime last week'

		expect(inBackoff(ledger['T-4'], NOW)).toBe(false)
		expect(retriesAt(ledger['T-4'])).toBeUndefined()
	})

	it('clears the failure state when the task finally goes green', () => {
		const ledger = failed(BACKOFF_AFTER, NOW)

		mark(
			ledger,
			'T-4',
			{
				contentHash: 'abc123',
				outcome: 'proved',
			},
			NOW,
		)

		expect(ledger['T-4']).toMatchObject({
			contentHash: 'abc123',
			outcome: 'proved',
		})
		expect(ledger['T-4'].failCount).toBeUndefined()
		expect(inBackoff(ledger['T-4'], NOW)).toBe(false)
	})

	it('drops the outcome again when a proved task goes red', () => {
		const ledger: Ledger = {}

		mark(
			ledger,
			'T-4',
			{
				outcome: 'proved',
			},
			NOW,
		)
		recordFailure(ledger, 'T-4', {}, NOW)

		expect(ledger['T-4'].outcome).toBeUndefined()
		expect(ledger['T-4'].failCount).toBe(1)
	})

	it('keeps the first sighting across every later write', () => {
		const ledger = failed(1, ago(72))

		recordFailure(ledger, 'T-4', {}, NOW)

		expect(ledger['T-4'].firstSeen).toBe(ago(72).toISOString())
		expect(ledger['T-4'].lastSeen).toBe(NOW.toISOString())
	})
})

describe('T3 · the ledger does not grow forever', () => {
	it('drops what nothing has mentioned in a long time, and keeps the rest', () => {
		const ledger = {
			...failed(1, ago(24 * 200)),
			...{
				'T-9': failed(1, NOW)['T-4'],
			},
		}

		prune(ledger, 90, NOW)

		expect(Object.keys(ledger)).toEqual([
			'T-9',
		])
	})

	it('prunes on its own default, so nobody has to remember the number', () => {
		const inside = failed(1, ago(24 * (PRUNE_DAYS - 1)))
		const outside = failed(1, ago(24 * (PRUNE_DAYS + 1)))

		prune(inside, undefined, NOW)
		prune(outside, undefined, NOW)

		expect(Object.keys(inside)).toEqual([
			'T-4',
		])
		expect(Object.keys(outside)).toEqual([])
	})

	it('prunes on save, rather than leaving it as a chore', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ledger-'))
		const file = join(directory, 'ledger.json')
		const ledger = failed(1, ago(24 * (PRUNE_DAYS + 1)))

		await save(file, ledger, NOW)

		expect(await load(file)).toEqual({})
	})
})

describe('T3 · reading and writing it', () => {
	it('round-trips, sorted, with a trailing newline', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ledger-'))
		const file = join(directory, 'board', 'ledger.json')
		const ledger: Ledger = {}

		mark(
			ledger,
			'T-9',
			{
				outcome: 'proved',
			},
			NOW,
		)
		mark(
			ledger,
			'T-1',
			{
				outcome: 'proved',
			},
			NOW,
		)

		await save(file, ledger, NOW)

		const written = await readFile(file, 'utf8')

		expect(written.endsWith('\n')).toBe(true)
		expect(Object.keys(JSON.parse(written))).toEqual([
			'T-1',
			'T-9',
		])
		expect(await load(file)).toEqual(ledger)
	})

	it('reads an absent or broken ledger as no history, never as a failure', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ledger-'))
		const broken = join(directory, 'broken.json')

		await writeFile(broken, '{ not json', 'utf8')

		expect(await load(join(directory, 'nothing.json'))).toEqual({})
		expect(await load(broken)).toEqual({})
	})

	it('refuses a payload that is not an object', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ledger-'))
		const file = join(directory, 'array.json')

		await writeFile(file, 'null', 'utf8')

		expect(await load(file)).toEqual({})
	})
})
