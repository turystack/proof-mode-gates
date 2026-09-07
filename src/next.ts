import type { Ledger, LedgerEntry } from '@/ledger.js'
import { inBackoff, retriesAt } from '@/ledger.js'
import { hashOf, hashOfAll } from '@/spec-hash.js'
import type { CheckContext } from '@/types.js'

import { declaredIds, readBoard, type Task } from '@/checks/harness.js'

/**
 * Why a row is on the list.
 *
 * Five kinds, and the split that matters is not "urgent / not urgent" — it is
 * **what the reader has to do to make it go away**. `uncovered` needs a board
 * entry, `ready` needs code, `stale` needs an audit, `unproven` needs a report
 * that records what it proved, and `waiting` needs somebody else first.
 */
export type NextKind = 'uncovered' | 'stale' | 'ready' | 'unproven' | 'waiting'

/**
 * One line of the selector's output.
 *
 * Deliberately the shape a loop's gate emits: a key, a digest of what it is
 * about, whether it can be picked up now, and the evidence for saying so. The
 * caller — a person, a script, or an agent — decides what to do with it. This
 * decides only what is open.
 */
export type NextRow = {
	actionable: boolean
	/** The digest this row was computed from, so a repeat run can skip it. */
	contentHash: string
	/** Why this row says what it says, in one line a person can check. */
	evidence: string
	key: string
	kind: NextKind
}

/** Statuses that mean the task is not waiting to be picked up. */
const IN_FLIGHT = new Set([
	'blocked',
	'doing',
])

const ORDER: NextKind[] = [
	'uncovered',
	'stale',
	'ready',
	'unproven',
	'waiting',
]

function labelOf(task: Task, index: number): string {
	return task.id ?? task.title ?? `task ${index + 1}`
}

type ReportPayload = {
	task?: {
		specHash?: Record<string, string>
	}
}

/** The ledger travels with the board it is about. */
export const LEDGER_FILE = 'ledger.json'

/**
 * What earlier runs left about these tasks, when there is a ledger to read.
 *
 * Absent is not broken. A project that has never recorded a run has no history,
 * and the selector says the same things it said before there was a ledger.
 */
async function readLedger(
	context: CheckContext,
	directory: string,
): Promise<Ledger> {
	const file = `${directory}/${LEDGER_FILE}`

	if (!context.files.includes(file)) {
		return {}
	}

	try {
		const parsed: unknown = JSON.parse(await context.read(file))

		return parsed !== null && typeof parsed === 'object'
			? (parsed as Ledger)
			: {}
	} catch {
		return {}
	}
}

/** How a run of red shows up in a row that is otherwise ready. */
function failureNote(entry: LedgerEntry | undefined): string {
	const count = entry?.failCount ?? 0

	return count === 0
		? ''
		: ` · ${count} failed run(s)${entry?.failedOn ? `, last on ${entry.failedOn}` : ''}`
}

/**
 * The report a done task points at, when it is where the task says it is.
 *
 * `board-report-linked` already fails a task that points at nothing, so this
 * does not repeat the finding — it reports what it can read, and says so when
 * it cannot.
 */
async function readReport(
	context: CheckContext,
	directory: string,
	task: Task,
): Promise<ReportPayload | undefined> {
	const report = task.report ?? ''

	if (report === '') {
		return undefined
	}

	const file = context.files.find(
		(candidate) =>
			candidate === report || candidate === `${directory}/${report}`,
	)

	if (!file) {
		return undefined
	}

	try {
		return JSON.parse(await context.read(file)) as ReportPayload
	} catch {
		return undefined
	}
}

/**
 * What is open, derived rather than remembered.
 *
 * The three questions `07-routine.md` opens a session with — implement, audit,
 * hunt — are answered by the board, the spec and the reports, all three of
 * which are files. Asking a model to read them and summarise is the expensive
 * way to compute something that has one right answer.
 *
 * A row is emitted only when there is something to say. A task whose claimed
 * decisions have not moved since its report produces no line at all, which is
 * what makes the list short enough to read.
 */
export async function next(
	context: CheckContext,
	{
		now = new Date(),
	}: {
		now?: Date
	} = {},
): Promise<NextRow[]> {
	const found = await readBoard(context)

	if (!found) {
		return []
	}

	const directory = found.file.slice(0, found.file.lastIndexOf('/'))
	const ledger = await readLedger(context, directory)
	const declared = await declaredIds(context)
	const hashes = new Map(
		[
			...declared.entries(),
		].map(([id, declaration]) => [
			id,
			hashOf(declaration),
		]),
	)

	const tasks = found.board.tasks ?? []
	const covered = new Set(tasks.flatMap((task) => task.covers ?? []))
	const rows: NextRow[] = []

	for (const [id, hash] of hashes) {
		if (!covered.has(id)) {
			rows.push({
				actionable: true,
				contentHash: hash,
				evidence: `declared in ${declared.get(id)?.file ?? 'the spec'} and no task names it`,
				key: id,
				kind: 'uncovered',
			})
		}
	}

	for (const [index, task] of tasks.entries()) {
		const key = labelOf(task, index)
		const covers = (task.covers ?? []).filter((id) => hashes.has(id))
		const contentHash = hashOfAll(covers.map((id) => hashes.get(id) ?? ''))

		if (task.status === 'done') {
			const report = await readReport(context, directory, task)

			if (!report) {
				rows.push({
					actionable: false,
					contentHash,
					evidence:
						'done, and its report could not be read — nothing records what was proved',
					key,
					kind: 'unproven',
				})
				continue
			}

			const recorded = report.task?.specHash ?? {}
			const unrecorded = covers.filter((id) => recorded[id] === undefined)
			const moved = covers.filter(
				(id) => recorded[id] !== undefined && recorded[id] !== hashes.get(id),
			)

			if (unrecorded.length > 0) {
				rows.push({
					actionable: false,
					contentHash,
					evidence: `the report records no digest for ${unrecorded.join(', ')} — whether the decision moved cannot be established`,
					key,
					kind: 'unproven',
				})
				continue
			}

			if (moved.length > 0) {
				rows.push({
					actionable: true,
					contentHash,
					evidence: `${moved.join(', ')} moved in the spec since the report proved it`,
					key,
					kind: 'stale',
				})
			}

			continue
		}

		if (IN_FLIGHT.has(task.status ?? '')) {
			rows.push({
				actionable: false,
				contentHash,
				evidence: `${task.status} — somebody is on it, or something is in the way`,
				key,
				kind: 'waiting',
			})
			continue
		}

		if (!task.casesApprovedBy) {
			rows.push({
				actionable: false,
				contentHash,
				evidence: 'its cases have not been approved by a person',
				key,
				kind: 'waiting',
			})
			continue
		}

		const entry = ledger[key]

		if (inBackoff(entry, now)) {
			rows.push({
				actionable: false,
				contentHash,
				evidence: `${entry?.failCount} failed run(s)${entry?.failedOn ? `, last on ${entry.failedOn}` : ''} — backing off until ${retriesAt(entry)}`,
				key,
				kind: 'waiting',
			})
			continue
		}

		rows.push({
			actionable: true,
			contentHash,
			evidence: `cases approved by ${task.casesApprovedBy}${covers.length > 0 ? ` · covers ${covers.join(', ')}` : ''}${failureNote(entry)}`,
			key,
			kind: 'ready',
		})
	}

	return rows.sort(
		(left, right) =>
			ORDER.indexOf(left.kind) - ORDER.indexOf(right.kind) ||
			left.key.localeCompare(right.key),
	)
}
