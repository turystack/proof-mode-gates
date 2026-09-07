import type { Check, CheckContext, Violation } from '@/types.js'

/**
 * `DLV-1`, `SPC-1`, `UIX-3` — a section of the project's own skills that still
 * carries its marker is a decision nobody made.
 *
 * This is the check that turns "the spec is silent" from something discovered
 * mid-implementation into a gate result. It reports every unfilled section it
 * finds; whether a given one blocks *this* task is the harness's judgment, so
 * the state is `warn` rather than `fail` when the task did not touch it.
 */

const MARKER = '<!-- turystack:unfilled -->'
const PROJECT_SKILL =
	/^\.(?:claude|codex)\/skills\/([^/]+-(?:spec|uiux))\/(.+\.md)$/
const FENCE = /```[\s\S]*?```/g

export function isProjectSkillSection(file: string): boolean {
	return PROJECT_SKILL.test(file)
}

/**
 * A skill explains its own marker inside a fenced block, so the fences are
 * blanked before searching — otherwise the documentation of the mechanism
 * reads as a use of it. Blanking rather than deleting keeps line numbers true.
 */
export function stripFences(source: string): string {
	return source.replace(FENCE, (block) =>
		'\n'.repeat(block.split('\n').length - 1),
	)
}

export const unfilled: Check = {
	id: 'context-resolved',
	rules: [
		'DLV-1',
		'SPC-1',
		'UIX-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const sections = context.files.filter(isProjectSkillSection)

		for (const file of sections) {
			const source = stripFences(await context.read(file))
			const index = source.indexOf(MARKER)

			if (index === -1) {
				continue
			}

			const skill = PROJECT_SKILL.exec(file)?.[1] ?? 'project skill'

			violations.push({
				file,
				line: source.slice(0, index).split('\n').length,
				message: `${skill} has an unfilled section — a task that depends on it stops and asks, it does not guess`,
				rule: 'DLV-1',
			})
		}

		// The manifest is what makes the project's skills findable without
		// guessing. Its absence is not fatal — the `-spec`/`-uiux` shape still
		// resolves them — but it is worth saying, because the harness reads the
		// manifest first.
		const manifest = context.files.find((file) =>
			/^\.(?:claude|codex)\/turystack\.json$/.test(file),
		)

		if (sections.length === 0) {
			// A repository with no `.claude/skills/` at all is a library, a config
			// package or a tool — not a task running under the harness. Failing it
			// for missing a project spec is this check answering a question nobody
			// asked, in every package that will never have one.
			const underHarness = context.files.some((file) =>
				/^\.(?:claude|codex)\/(?:skills\/|turystack\.json$)/.test(file),
			)

			return underHarness
				? {
						id: 'context-resolved',
						state: 'fail',
						summary:
							'no project skill found — materialize <project>-spec and <project>-uiux with `turystack skills --skills spec,uiux`',
						violations: [],
					}
				: {
						id: 'context-resolved',
						state: 'skipped',
						summary:
							'not a harness project — no .claude/ to resolve inputs from',
						violations: [],
					}
		}

		if (!manifest) {
			violations.push({
				file: '.claude/turystack.json',
				message:
					'no project manifest — the harness falls back to the -spec/-uiux shape, but re-running `turystack skills` writes the names down',
				rule: 'DLV-3',
			})
		}

		return {
			id: 'context-resolved',
			state: violations.length > 0 ? 'warn' : 'pass',
			summary:
				violations.length > 0
					? `${violations.length} of ${sections.length} section(s) still unfilled`
					: `${sections.length} section(s), all filled`,
			violations,
		}
	},
}
