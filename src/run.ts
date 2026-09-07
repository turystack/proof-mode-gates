import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { LADDER } from '@/ladder.js'
import type { CheckResult, RungResult } from '@/types.js'

const exec = promisify(execFile)

/**
 * Which package script each rung runs, in order of preference.
 *
 * The runner deliberately does not know project-specific commands — the
 * scaffold already writes these scripts, so the runner contributes the three
 * things a chain of `&&` cannot: order it can explain, a rung that is *absent*
 * rather than green, and the raw output captured into the report.
 */
export const RUNG_SCRIPTS: Record<string, string[]> = {
	coverage: [
		'test:coverage',
	],
	e2e: [
		'test:e2e',
	],
	format: [
		'format',
	],
	lint: [
		'check',
		'lint',
	],
	structure: [],
	test: [
		'test',
	],
	typecheck: [
		'typecheck',
	],
	visual: [
		'test:visual',
		'test:e2e:visual',
	],
}

export type RunOutcome = {
	raw: Record<string, string>
	results: RungResult[]
}

export function resolveScript(
	rung: string,
	scripts: Record<string, string>,
): string | undefined {
	return (RUNG_SCRIPTS[rung] ?? []).find((name) => name in scripts)
}

export async function readScripts(
	cwd: string,
): Promise<Record<string, string>> {
	try {
		const manifest = JSON.parse(
			await readFile(resolve(cwd, 'package.json'), 'utf8'),
		) as {
			scripts?: Record<string, string>
		}

		return manifest.scripts ?? {}
	} catch {
		return {}
	}
}

/**
 * `format` is the only rung that changes files, so passing it means two things:
 * the formatter ran, and it had nothing to do.
 *
 * The comparison is before-and-after rather than `git diff --exit-code`,
 * because a developer's tree is legitimately dirty while they work. What the
 * rung is asking is not "is anything uncommitted" — it is "did the formatter
 * rewrite something", and only the delta answers that.
 */
async function status(cwd: string): Promise<string> {
	const { stdout } = await exec(
		'git',
		[
			'status',
			'--porcelain',
		],
		{
			cwd,
		},
	).catch(() => ({
		stdout: '',
	}))

	return stdout
}

async function formatIsClean(cwd: string, runner: string, script: string) {
	const before = await status(cwd)
	await exec(
		runner,
		[
			'run',
			script,
		],
		{
			cwd,
		},
	).catch(() => undefined)
	const after = await status(cwd)

	if (before === after) {
		return {
			clean: true,
			output: '',
		}
	}

	const { stdout } = await exec(
		'git',
		[
			'diff',
			'--stat',
		],
		{
			cwd,
		},
	).catch(() => ({
		stdout: '',
	}))

	return {
		clean: false,
		output: stdout,
	}
}

export async function runLadder(options: {
	cwd: string
	packageManager?: string
	structure: () => Promise<CheckResult[]>
}): Promise<RunOutcome> {
	const runner = options.packageManager ?? 'pnpm'
	const scripts = await readScripts(options.cwd)
	const results: RungResult[] = []
	const raw: Record<string, string> = {}
	let stopped = false

	for (const rung of LADDER) {
		if (stopped) {
			results.push({
				...rung,
				note: 'an earlier rung was red, so this one would report on code that was already rejected',
				result: '—',
				state: 'skipped',
			})
			continue
		}

		if (rung.id === 'structure') {
			const checks = await options.structure()
			const failed = checks.filter((check) => check.state === 'fail')
			const pending = checks.filter((check) => check.state === 'pending')

			raw.structure = checks
				.map(
					(check) =>
						`${check.state.padEnd(8)} gate:${check.id}  ${check.summary}`,
				)
				.join('\n')

			results.push({
				...rung,
				note:
					pending.length > 0
						? `${pending.length} declared check(s) not implemented by this runner — reported as pending, never as passing`
						: undefined,
				result: `${checks.length - failed.length}/${checks.length} checks`,
				state: failed.length > 0 ? 'fail' : 'pass',
			})

			stopped = failed.length > 0
			continue
		}

		const script = resolveScript(rung.id, scripts)

		// A rung with no script is not green. "This project has no e2e" is a fact
		// worth printing; pretending it passed is how a gate becomes decorative.
		if (!script) {
			results.push({
				...rung,
				note: `no ${RUNG_SCRIPTS[rung.id]?.join(' or ') ?? rung.id} script in package.json`,
				result: 'not configured',
				state: 'skipped',
			})
			continue
		}

		if (rung.id === 'format') {
			const format = await formatIsClean(options.cwd, runner, script)
			raw.format = format.output

			results.push({
				...rung,
				command: `${runner} run ${script}, then compare git status`,
				note: format.clean
					? undefined
					: 'the formatter changed files, so every diff below it is noise',
				result: format.clean ? '0 files rewritten' : 'files were rewritten',
				state: format.clean ? 'pass' : 'fail',
			})

			stopped = !format.clean
			continue
		}

		try {
			const { stdout } = await exec(
				runner,
				[
					'run',
					script,
				],
				{
					cwd: options.cwd,
				},
			)
			raw[rung.id] = stdout.trim()

			results.push({
				...rung,
				command: `${runner} run ${script}`,
				result: 'passed',
				state: 'pass',
			})
		} catch (error) {
			const failure = error as {
				stderr?: string
				stdout?: string
			}
			raw[rung.id] = `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim()

			results.push({
				...rung,
				command: `${runner} run ${script}`,
				result: 'failed',
				state: 'fail',
			})

			stopped = true
		}
	}

	return {
		raw,
		results,
	}
}
