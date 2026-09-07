#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { howto } from '@/howto.js'
import { LADDER } from '@/ladder.js'
import { load, mark, recordFailure, save } from '@/ledger.js'
import type { NextRow } from '@/next.js'
import { LEDGER_FILE, next } from '@/next.js'
import type { GateReport } from '@/report.js'
import { emit, summaryLine, verdictOf } from '@/report.js'
import { runLadder } from '@/run.js'
import { inspectSkill } from '@/skill.js'
import { hashOfAll, specHashesFor } from '@/spec-hash.js'
import type { CheckContext, CheckResult, RungResult } from '@/types.js'

import { isHarnessProject, readBoard } from '@/checks/harness.js'
import { pendingChecks, runChecks } from '@/checks/registry.js'

const run = promisify(execFile)

const HELP = `turystack-proof

Usage:
  turystack-proof run [--out <dir>]      the whole ladder, in order, then the report
  turystack-proof run --dry-run          the rungs it would run, and on what - runs nothing
  turystack-proof next [--json]          what is open, and why - no LLM
  turystack-proof next --markdown        the same, as a digest to paste or pipe
  turystack-proof structure [--json]     only the structural checks
  turystack-proof report [--out <dir>]   emit gate-report.json and .html
  turystack-proof skill [<dir>]          validate one skill package on its own
  turystack-proof howto [<dir>]          a materialized skill's start-here comments
  turystack-proof howto [<dir>] --strip  removes them, once the skill is started
  turystack-proof --help

Options:
  --baseline <ref>   what "changed" is measured against (default: origin/main)
  --only <a,b>       run only these structural checks
  --pm <manager>     package manager used to run the scripts (default: pnpm)
  --declared <a,b>   gate: bindings a skill declares, so unimplemented ones
                     appear as pending rather than silently absent
  --covers <a,b>     the ids this report claims; their spec digests travel with
                     it, so a later 'next' can tell proved from moved
  --task <id>        the board task this run is for; its outcome is recorded in
                     the ledger beside the board, so red survives the session
  --limit <n>        show at most n rows, and say how many were dropped
  --no-merge         overwrite the report instead of keeping the evidence blocks
                     the runner did not produce
`

async function git(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await run('git', args, {
			cwd,
		})
		return stdout
	} catch {
		return ''
	}
}

async function buildContext(
	cwd: string,
	baseline: string,
): Promise<CheckContext> {
	// Tracked **and** untracked-but-not-ignored. `ls-files` alone hides exactly
	// the files a gate exists for: the ones just written. A new component with
	// no test, a new element with no slot, a new route with no ACL — all of them
	// are untracked at the moment they most need checking, and a runner that
	// reads only the index reports green on work it never opened.
	const tracked = await git(cwd, [
		'ls-files',
		'--cached',
		'--others',
		'--exclude-standard',
	])
	const diff = await git(cwd, [
		'diff',
		'--name-only',
		`${baseline}...HEAD`,
	])
	const cache = new Map<string, string>()

	return {
		changed: diff.split('\n').filter(Boolean),
		cwd,
		files: tracked.split('\n').filter(Boolean),
		async read(file: string) {
			const cached = cache.get(file)

			if (cached !== undefined) {
				return cached
			}

			const contents = await readFile(resolve(cwd, file), 'utf8').catch(
				() => '',
			)
			cache.set(file, contents)

			return contents
		},
	}
}

function print(results: CheckResult[]): void {
	for (const result of results) {
		const mark =
			result.state === 'pass'
				? '✓'
				: result.state === 'fail'
					? '✖'
					: result.state === 'pending'
						? '·'
						: '~'

		process.stdout.write(
			`  ${mark} gate:${result.id.padEnd(24)} ${result.summary}\n`,
		)

		for (const violation of result.violations) {
			const where = violation.line
				? `${violation.file}:${violation.line}`
				: violation.file
			process.stdout.write(
				`      ${violation.rule}  ${where}\n        ${violation.message}\n`,
			)
		}
	}
}

const MARK: Record<NextRow['kind'], string> = {
	ready: '\u2192',
	stale: '~',
	uncovered: '!',
	unproven: '\u00b7',
	waiting: '\u00b7',
}

function markdownNext(rows: NextRow[]): string {
	const open = rows.filter((row) => row.actionable)

	if (rows.length === 0) {
		return '**Nothing open.** Every declared id is scheduled, and every report still matches its spec.\n'
	}

	return [
		`**${open.length} open** · ${rows.length - open.length} waiting on somebody`,
		'',
		'| | id | why |',
		'|---|---|---|',
		...rows.map((row) => `| ${row.kind} | \`${row.key}\` | ${row.evidence} |`),
		'',
	].join('\n')
}

function printNext(rows: NextRow[]): void {
	for (const row of rows) {
		process.stdout.write(
			`  ${MARK[row.kind]} ${row.key.padEnd(12)} ${row.kind.padEnd(10)} ${row.evidence}\n`,
		)
	}

	const open = rows.filter((row) => row.actionable).length

	process.stdout.write(
		rows.length === 0
			? '\n\u2713 nothing open - every declared id is scheduled, and every report still matches its spec\n'
			: `\n${open} actionable, ${rows.length - open} waiting on somebody\n`,
	)
}

function readOption(args: string[], name: string, fallback: string): string {
	const index = args.indexOf(name)

	return index === -1 ? fallback : (args[index + 1] ?? fallback)
}

/**
 * Which skills this report was produced under.
 *
 * A green report from one version of the law is not evidence under another, so
 * the versions travel with it.
 */
async function installedSkills(context: CheckContext): Promise<
	{
		name: string
		version: string
	}[]
> {
	const manifests = context.files.filter((file) =>
		/^\.(?:claude|codex)\/skills\/[^/]+\/SKILL\.md$/.test(file),
	)

	const skills: {
		name: string
		version: string
	}[] = []

	for (const file of manifests) {
		const source = await context.read(file)
		const name = /^name:\s*"?([^"\n]+)"?/m.exec(source)?.[1]

		if (name) {
			skills.push({
				name: name.trim(),
				version: 'installed',
			})
		}
	}

	return skills
}

/**
 * Write what this run concluded about the task, beside the board.
 *
 * Only on `--task`: a run that does not say which task it is for has nothing to
 * key an entry on, and inventing one would produce history about a task nobody
 * can find again.
 *
 * The failing rung is the signature. It is already known here, exactly, which
 * beats scraping a log for a phrase that might mean auth and might mean a test
 * that printed the word "forbidden".
 */
async function record(
	context: CheckContext,
	task: string,
	verdict: string,
	ladder: RungResult[],
	claimed: Record<string, unknown>,
): Promise<void> {
	if (task === '') {
		return
	}

	const board = await readBoard(context)

	if (!board) {
		process.stderr.write(
			'  no board to record against — the outcome was not written\n',
		)
		return
	}

	const file = resolve(
		context.cwd,
		board.file.slice(0, board.file.lastIndexOf('/')),
		LEDGER_FILE,
	)
	const ledger = await load(file)
	const digests = Object.values(
		(claimed.specHash as Record<string, string> | undefined) ?? {},
	)

	if (verdict === 'pass') {
		mark(ledger, task, {
			contentHash: digests.length > 0 ? hashOfAll(digests) : undefined,
			outcome: 'proved',
		})
	} else {
		recordFailure(ledger, task, {
			rung: ladder.find((rung) => rung.state === 'fail')?.id,
		})
	}

	await save(file, ledger)

	process.stdout.write(`  recorded ${task} → ${verdict} in ${file}\n`)
}

async function main(): Promise<void> {
	const args = process.argv.slice(2)

	if (args.length === 0 || args.includes('--help')) {
		process.stdout.write(HELP)
		return
	}

	const cwd = process.cwd()

	// Before the context is built: this one edits files rather than reading a
	// repository, and it has to work in a checkout with no git history.
	if (args[0] === 'howto') {
		const directory = args[1] && !args[1].startsWith('--') ? args[1] : cwd
		const strip = args.includes('--strip')
		const found = await howto(directory, strip)
		const blocks = found.reduce((total, item) => total + item.blocks, 0)

		for (const item of found) {
			process.stdout.write(
				`  ${strip ? '✓' : '·'} ${item.file}  ${item.blocks} block(s)\n`,
			)
		}

		process.stdout.write(
			found.length === 0
				? '\nNo start-here comments left — this skill has been started.\n'
				: strip
					? `\n✓ ${blocks} block(s) removed from ${found.length} file(s). The unfilled markers are untouched.\n`
					: `\n${blocks} block(s) in ${found.length} file(s). Pass --strip to remove them.\n`,
		)
		return
	}

	const baseline = readOption(args, '--baseline', 'origin/main')
	const only = args.includes('--only')
		? readOption(args, '--only', '').split(',').filter(Boolean)
		: undefined

	const context = await buildContext(cwd, baseline)
	const command = args[0]

	if (command === 'next') {
		if (!isHarnessProject(context)) {
			process.stdout.write(
				'not a harness project — there is no board to select from\n',
			)
			return
		}

		/**
		 * A selector that cannot read its own inputs says so, loudly.
		 *
		 * Silence here would be indistinguishable from "nothing to do", and a
		 * detector that fails quietly is how a broken one passes for a quiet week.
		 */
		if (!(await readBoard(context))) {
			process.stderr.write(
				'harness project with no readable board — derive it before asking what is open\n',
			)
			process.exitCode = 1
			return
		}

		const all = await next(context)
		const limit = args.includes('--limit')
			? Number(readOption(args, '--limit', '0'))
			: Number.POSITIVE_INFINITY
		const rows = Number.isFinite(limit) && limit > 0 ? all.slice(0, limit) : all

		if (args.includes('--json')) {
			process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
		} else if (args.includes('--markdown')) {
			process.stdout.write(markdownNext(rows))
		} else {
			printNext(rows)
		}

		/**
		 * A cap that hides its own effect is a lie about coverage.
		 *
		 * `--limit` exists so a digest stays readable, and the moment it silently
		 * drops a row the list starts reading as "this is everything".
		 */
		if (rows.length < all.length) {
			process.stdout.write(
				`\n${all.length - rows.length} more row(s) not shown - raise --limit to see them\n`,
			)
		}

		return
	}

	const results = await runChecks(context, only)
	const declared = args.includes('--declared')
		? readOption(args, '--declared', '').split(',').filter(Boolean)
		: []
	const covers = args.includes('--covers')
		? readOption(args, '--covers', '').split(',').filter(Boolean)
		: []
	const task = args.includes('--task') ? readOption(args, '--task', '') : ''

	/**
	 * What the report claims, and what those decisions said when it claimed them.
	 *
	 * The digests are computed here, from the disk, rather than accepted from
	 * whoever assembles the payload. A hash a report supplies about itself proves
	 * the same amount as a verdict a report declares about itself.
	 */
	const claim = async (): Promise<Record<string, unknown>> => {
		if (covers.length === 0) {
			return {
				finishedAt: new Date().toISOString(),
			}
		}

		const specHash = await specHashesFor(context, covers)
		const missing = covers.filter((id) => specHash[id] === undefined)

		/**
		 * A claimed id the spec does not declare gets no digest, and saying so is
		 * the difference between a report that cannot be audited and one that
		 * looks like it can.
		 *
		 * The common cause is not a typo: the runner reads tracked files, so a
		 * report emitted before the spec is committed records nothing and looks
		 * exactly like a report of a task with no decisions behind it.
		 */
		if (missing.length > 0) {
			process.stderr.write(
				`  no digest for ${missing.join(', ')} — not declared in any tracked spec file.\n` +
					'  The report will carry no proof of what those decisions said; commit the spec, or check the ids.\n',
			)
		}

		return {
			covers,
			finishedAt: new Date().toISOString(),
			specHash,
		}
	}

	if (command === 'run') {
		/**
		 * The rung before the ladder.
		 *
		 * Everything below runs commands, writes a report and records an outcome.
		 * Being able to see what that would be, without any of it happening, is
		 * what makes the first live run on a new project supervisable.
		 */
		if (args.includes('--dry-run')) {
			for (const rung of LADDER) {
				process.stdout.write(`  · ${rung.name.padEnd(20)} ${rung.command}\n`)
			}

			const pending = pendingChecks(declared)

			process.stdout.write(
				`\n${LADDER.length} rung(s), ${results.length} structural check(s), ${pending.length} declared and not implemented\n` +
					`  would write ${resolve(readOption(args, '--out', cwd), 'gate-report.json')}\n` +
					`${task ? `  would record ${task} in the ledger beside the board\n` : ''}` +
					'nothing ran\n',
			)
			return
		}

		const { raw, results: ladder } = await runLadder({
			cwd,
			packageManager: readOption(args, '--pm', 'pnpm'),
			structure: async () => [
				...results,
				...pendingChecks(declared),
			],
		})

		for (const rung of ladder) {
			const mark =
				rung.state === 'pass' ? '✓' : rung.state === 'fail' ? '✖' : '·'

			process.stdout.write(
				`  ${mark} ${rung.name.padEnd(20)} ${rung.result}${rung.note ? `\n      ${rung.note}` : ''}\n`,
			)
		}

		const claimed = await claim()
		const report: GateReport = {
			ladder,
			provenance: {
				runner: '@turystack/proof-mode-gates',
				skills: await installedSkills(context),
			},
			raw,
			schema: 'turystack.gate-report/1',
			structure: [
				...results,
				...pendingChecks(declared),
			],
			task: claimed,
		}

		const written = await emit(report, readOption(args, '--out', cwd), {
			merge: !args.includes('--no-merge'),
		})
		/**
		 * Read the verdict off what was written, not off what was assembled.
		 *
		 * They differ the moment a merge brings back evidence the runner did not
		 * produce — a screen with a missing capture fails a payload that had no
		 * screens in it. A terminal line disagreeing with the artifact beside it
		 * is the "green summary the tools never printed" the raw block exists to
		 * make impossible.
		 */
		const verdict = verdictOf(written.payload)

		process.stdout.write(
			`\n${summaryLine(written.payload)}\n  ${written.json}\n  ${written.html}\n`,
		)

		if (written.merged.length > 0) {
			process.stdout.write(
				`  kept from the report already there: ${written.merged.join(', ')}\n`,
			)
		}

		await record(context, task, verdict, ladder, claimed)

		process.exitCode = verdict === 'pass' ? 0 : 1
		return
	}

	// `skill` reads a directory rather than the gate context: a published skill's
	// CI sees one package, and this is what that package can prove about itself.
	if (command === 'skill') {
		const directory = args[1] && !args[1].startsWith('--') ? args[1] : cwd
		const report = await inspectSkill(directory)

		for (const violation of report.violations) {
			const where = violation.line
				? `${violation.file}:${violation.line}`
				: violation.file
			process.stdout.write(
				`  ✖ ${violation.rule.padEnd(6)} ${where}\n      ${violation.message}\n`,
			)
		}

		process.stdout.write(
			report.violations.length > 0
				? `\n✖ ${report.name}: ${report.violations.length} problem(s) across ${report.sections} section(s)\n`
				: `\n✓ ${report.name}: ${report.laws} law(s) across ${report.sections} section(s), every table renders and every law names a gate and a class\n`,
		)

		process.exitCode = report.violations.length > 0 ? 1 : 0
		return
	}

	if (command === 'structure') {
		if (args.includes('--json')) {
			process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
		} else {
			print(results)
		}

		process.exitCode = results.some((result) => result.state === 'fail') ? 1 : 0
		return
	}

	if (command === 'report') {
		// A skill declares more `gate:` bindings than this runner implements. The
		// unimplemented ones are carried into the report as `pending`, never as
		// absent — a report that drops what it cannot check claims coverage it
		// does not have.
		const report: GateReport = {
			ladder: [],
			provenance: {
				runner: '@turystack/proof-mode-gates',
				skills: await installedSkills(context),
			},
			schema: 'turystack.gate-report/1',
			structure: [
				...results,
				...pendingChecks(declared),
			],
			task: await claim(),
		}

		const out = readOption(args, '--out', cwd)
		const written = await emit(report, out, {
			merge: !args.includes('--no-merge'),
		})

		process.stdout.write(
			`${summaryLine(written.payload)}\n  ${written.json}\n  ${written.html}\n`,
		)

		if (written.merged.length > 0) {
			process.stdout.write(
				`  kept from the report already there: ${written.merged.join(', ')}\n`,
			)
		}

		process.exitCode = verdictOf(written.payload) === 'pass' ? 0 : 1
		return
	}

	throw new Error(`Unknown command: ${command}`)
}

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	)
	process.exitCode = 1
})
