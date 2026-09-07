import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CheckResult, RungResult } from '@/types.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAYLOAD =
	/(<script type="application\/json" id="gate-report">)([\s\S]*?)(<\/script>)/

/**
 * What a report can conclude.
 *
 * Three states, not two: a delivery can be proved, disproved, or not yet
 * either. Collapsing the third into `pass` is how an empty run ships green.
 */
export type Verdict = 'pass' | 'fail' | 'inconclusive'

export type GateReport = {
	schema: 'turystack.gate-report/1'
	task: Record<string, unknown>
	provenance: Record<string, unknown>
	ladder: RungResult[]
	structure?: CheckResult[]
	[key: string]: unknown
}

/**
 * The verdict is computed here and nowhere else.
 *
 * A payload cannot declare itself green: if a rung is red or a required piece
 * of evidence is missing, this says so. That is `ARC-TST-7` — nothing passes
 * empty — applied to the delivery itself.
 */
export function verdictOf(report: GateReport): Verdict {
	const redRung = report.ladder.some((rung) => rung.state === 'fail')
	const redCheck = (report.structure ?? []).some(
		(check) => check.state === 'fail',
	)

	const screens = ((
		report.frontend as
			| {
					screens?: unknown[]
			  }
			| undefined
	)?.screens ?? []) as {
		captures?: {
			image?: string | null
			state: string
		}[]
		required?: string[]
	}[]

	const missingEvidence = screens.some((screen) => {
		const captured = new Set(
			(screen.captures ?? [])
				.filter((capture) => capture.image)
				.map((capture) => capture.state),
		)

		return (screen.required ?? []).some((state) => !captured.has(state))
	})

	if (redRung || redCheck || missingEvidence) {
		return 'fail'
	}

	/**
	 * Nothing ran is not the same as nothing failed.
	 *
	 * A report with an empty ladder and every structural check `skipped` has no
	 * red in it, and said `pass` — the exact green-about-nothing this project
	 * refuses everywhere else. `conclude()` already treats "nothing to inspect"
	 * as `skipped` rather than `pass`, and `ARC-TST-7` refuses a suite that
	 * passes empty; the verdict was the one place still counting an absence of
	 * failure as a success.
	 *
	 * `inconclusive` rather than `fail` because the work is not proven wrong —
	 * it is unproven, and those need different words. A reader who sees `fail`
	 * goes looking for the defect; a reader who sees `inconclusive` goes looking
	 * for the rung that never ran.
	 */
	const ranSomething =
		report.ladder.some((rung) => rung.state === 'pass') ||
		(report.structure ?? []).some(
			(check) => check.state === 'pass' || check.state === 'warn',
		)

	return ranSomething ? 'pass' : 'inconclusive'
}

/** One line for a pull request comment; the page is for a human, this is for a feed. */
export function summaryLine(report: GateReport): string {
	const verdict = verdictOf(report)
	const green = report.ladder.filter((rung) => rung.state === 'pass').length
	const pending = (report.structure ?? []).filter(
		(check) => check.state === 'pending',
	).length

	// `inconclusive` gets its own mark. A feed showing ✖ for "nothing ran" sends
	// someone hunting a defect that is not there; ∅ sends them to the rung that
	// never ran, which is where the problem actually is.
	const mark = verdict === 'pass' ? '✓' : verdict === 'fail' ? '✖' : '∅'

	if (verdict === 'inconclusive') {
		return `${mark} nothing ran — ${report.ladder.length} rung(s), no check reached a conclusion`
	}

	return `${mark} ${green}/${report.ladder.length} gates${
		pending > 0 ? ` · ${pending} check(s) not implemented` : ''
	}`
}

export async function renderHtml(report: GateReport): Promise<string> {
	const template = await readFile(
		resolve(PACKAGE_ROOT, 'templates/report.html'),
		'utf8',
	)

	if (!PAYLOAD.test(template)) {
		throw new Error('report template has no #gate-report payload block')
	}

	const payload = JSON.stringify(
		{
			...report,
			verdict: verdictOf(report),
		},
		null,
		2,
	)

	return template.replace(
		PAYLOAD,
		(_match, open: string, _body: string, close: string) =>
			`${open}\n${payload}\n${close}`,
	)
}

/**
 * What the runner computes, and therefore what it always owns.
 *
 * Everything else in a payload — the evidence blocks, the contract delta, the
 * context — is assembled by whoever ran the task, and the runner has nothing
 * truer to put in its place.
 */
const RUNNER_OWNED = new Set([
	'ladder',
	'provenance',
	'schema',
	'structure',
	'verdict',
])

/**
 * The payload already on disk, when it is one of ours.
 *
 * A file that is not a `turystack.gate-report/1` is left out of the merge
 * rather than half-adopted: preserving keys from something nobody can identify
 * is how a report ends up carrying evidence from a different tool.
 */
async function existingReport(
	file: string,
): Promise<Record<string, unknown> | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))

		if (
			parsed !== null &&
			typeof parsed === 'object' &&
			(parsed as GateReport).schema === 'turystack.gate-report/1'
		) {
			return parsed as Record<string, unknown>
		}
	} catch {
		return undefined
	}

	return undefined
}

/**
 * Write the report, keeping the evidence the runner did not produce.
 *
 * The runner computes five things and assembles the rest of the payload from
 * nothing. Writing that over a report whose backend, frontend and law blocks
 * were already filled deleted the only part an audit reads — so the blocks the
 * runner owns are written, and the blocks it does not are kept.
 *
 * The verdict is recomputed over the **merged** object, never carried across.
 * That is the point of `DLV-14`: preserving a `verdict` key from disk would let
 * a report keep a green it no longer earns.
 */
export async function emit(
	report: GateReport,
	directory: string,
	{
		merge = true,
	}: {
		merge?: boolean
	} = {},
): Promise<{
	html: string
	json: string
	merged: string[]
	/** What was actually written — the only object whose verdict is the truth. */
	payload: GateReport
}> {
	const json = resolve(directory, 'gate-report.json')
	const html = resolve(directory, 'gate-report.html')
	const existing = merge ? await existingReport(json) : undefined

	const kept = Object.keys(existing ?? {}).filter(
		(key) => !RUNNER_OWNED.has(key) && !(key in report),
	)

	const payload: GateReport = existing
		? {
				...existing,
				...report,
				task: {
					...((existing.task as Record<string, unknown> | undefined) ?? {}),
					...report.task,
				},
			}
		: report

	await writeFile(
		json,
		JSON.stringify(
			{
				...payload,
				verdict: verdictOf(payload),
			},
			null,
			2,
		),
		'utf8',
	)
	await writeFile(html, await renderHtml(payload), 'utf8')

	return {
		html,
		json,
		merged: kept,
		payload,
	}
}
