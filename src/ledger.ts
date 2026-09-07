import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * What a run left behind about one task.
 *
 * Timestamps are ISO strings rather than epoch numbers because this file is
 * committed: a diff that reads `2026-08-25T21:04:35.228Z` tells a reviewer what
 * happened, and one that reads `1787692` tells them to go and convert it.
 */
export type LedgerEntry = {
	/** The digest the task's decisions had when it was last proved. */
	contentHash?: string
	failCount?: number
	failedAt?: string
	/** Which rung went red — a signature that needs no log-scraping to get. */
	failedOn?: string
	firstSeen: string
	lastSeen: string
	outcome?: string
}

export type Ledger = Record<string, LedgerEntry>

/** Failures before a task stops being offered every time somebody asks. */
export const BACKOFF_AFTER = 3
/** How long it stays out, so a broken task retries ~4×/day and not ~400×. */
export const BACKOFF_HOURS = 6
/** How long an entry nothing has touched survives a prune. */
export const PRUNE_DAYS = 90

const HOUR = 3_600_000

function at(now: Date): string {
	return now.toISOString()
}

function since(stamp: string | undefined, now: Date): number {
	const parsed = stamp === undefined ? Number.NaN : Date.parse(stamp)

	return Number.isNaN(parsed)
		? Number.POSITIVE_INFINITY
		: now.getTime() - parsed
}

/**
 * Whether a task has failed enough, recently enough, to be left alone.
 *
 * The threshold is not about giving up. A task that fails three runs is not a
 * hard task — it is a task whose spec, cases or environment is wrong, and
 * offering it again forty minutes later produces the same red and teaches
 * whoever is reading the list to stop reading it.
 */
export function inBackoff(
	entry: LedgerEntry | undefined,
	now: Date = new Date(),
): boolean {
	if (!entry || (entry.failCount ?? 0) < BACKOFF_AFTER) {
		return false
	}

	return since(entry.failedAt, now) < BACKOFF_HOURS * HOUR
}

/** When a backed-off task is offered again, for a message a person can act on. */
export function retriesAt(entry: LedgerEntry | undefined): string | undefined {
	if (!entry?.failedAt) {
		return undefined
	}

	const parsed = Date.parse(entry.failedAt)

	return Number.isNaN(parsed)
		? undefined
		: new Date(parsed + BACKOFF_HOURS * HOUR).toISOString()
}

function touch(ledger: Ledger, key: string, now: Date): LedgerEntry {
	const entry = ledger[key] ?? {
		firstSeen: at(now),
		lastSeen: at(now),
	}

	entry.lastSeen = at(now)
	ledger[key] = entry

	return entry
}

/**
 * Record a proved run.
 *
 * The failure state is cleared here and only here: a task that goes green has
 * stopped being the task that was failing, and carrying its count forward would
 * back it off on its next unrelated red.
 */
export function mark(
	ledger: Ledger,
	key: string,
	{
		contentHash,
		outcome,
	}: {
		contentHash?: string
		outcome: string
	},
	now: Date = new Date(),
): LedgerEntry {
	const entry = touch(ledger, key, now)

	entry.outcome = outcome

	if (contentHash !== undefined) {
		entry.contentHash = contentHash
	}

	delete entry.failCount
	delete entry.failedAt
	delete entry.failedOn

	return entry
}

/**
 * Record a run that went red, and on which rung.
 *
 * The rung is the signature. The loop kit this borrows from scrapes a log with
 * a regex to guess why a run died; a ladder already knows, and a guess is worth
 * less than the thing it is guessing at.
 */
export function recordFailure(
	ledger: Ledger,
	key: string,
	{
		rung,
	}: {
		rung?: string
	} = {},
	now: Date = new Date(),
): LedgerEntry {
	const entry = touch(ledger, key, now)

	entry.failCount = (entry.failCount ?? 0) + 1
	entry.failedAt = at(now)

	if (rung !== undefined) {
		entry.failedOn = rung
	}

	delete entry.outcome

	return entry
}

/**
 * Drop entries for keys nothing has mentioned in a long time.
 *
 * Called on every save rather than offered as a chore nobody runs. A ledger
 * that only grows becomes a file people stop opening, which is the same as not
 * having one.
 */
export function prune(
	ledger: Ledger,
	days: number = PRUNE_DAYS,
	now: Date = new Date(),
): Ledger {
	for (const [key, entry] of Object.entries(ledger)) {
		if (since(entry.lastSeen, now) > days * 24 * HOUR) {
			delete ledger[key]
		}
	}

	return ledger
}

/** An unreadable ledger is an empty one — history is not worth failing a run over. */
export async function load(file: string): Promise<Ledger> {
	try {
		const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))

		return parsed !== null && typeof parsed === 'object'
			? (parsed as Ledger)
			: {}
	} catch {
		return {}
	}
}

export async function save(
	file: string,
	ledger: Ledger,
	now: Date = new Date(),
): Promise<void> {
	await mkdir(dirname(file), {
		recursive: true,
	})

	const pruned = prune(ledger, PRUNE_DAYS, now)
	const sorted = Object.fromEntries(
		Object.entries(pruned).sort(([left], [right]) => left.localeCompare(right)),
	)

	await writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}
