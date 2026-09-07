import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { stripFences } from '@/checks/unfilled.js'

/**
 * The checks that belong to the step before a task exists.
 *
 * `turystack-harness` decides whether a project can be coded in at all: its own
 * two skills written, one theme per design system, and a board every task is
 * taken from. Each of those is a claim about files, which is exactly the kind of
 * claim that rots quietly — a board nobody derived and a theme copy nobody
 * compared both look like work that was done.
 */

const AGENT = String.raw`\.(?:claude|codex)`
const SPEC_SKILL = new RegExp(`^${AGENT}/skills/([^/]+-spec)/`)
const UIUX_SKILL = new RegExp(`^${AGENT}/skills/([^/]+-uiux)/`)
const MANIFEST = new RegExp(`^${AGENT}/turystack\\.json$`)
const UNDER_HARNESS = new RegExp(`^${AGENT}/(?:skills/|turystack\\.json$)`)
const BOARD_STATE = new RegExp(
	`^${AGENT}/skills/[^/]+-spec/board/tasks\\.json$`,
)
const BOARD_PAGE = new RegExp(
	`^${AGENT}/skills/[^/]+-spec/board/template\\.html$`,
)
/** The page and its filled twin, wherever a board ships them side by side. */
const BOARD_TEMPLATE = /(?:^|\/)board\/template\.html$/
const BOARD_EXAMPLE = /(?:^|\/)board\/example\.html$/
const THEME = new RegExp(
	`^${AGENT}/skills/([^/]+-uiux)/theme/([\\w.-]+)\\.css$`,
)
/**
 * Files the skill ships to be read, not to be worn.
 *
 * `template.css` is where a project starts one of its themes and `example.css`
 * is a worked one; neither is a design system this project has, so demanding
 * they appear in the index — or comparing them against an application's copy —
 * would produce findings about documentation.
 */
const RESERVED_THEME = new Set([
	'example',
	'template',
])
const THEME_INDEX = new RegExp(`^${AGENT}/skills/[^/]+-uiux/07-theme\\.md$`)

/**
 * The project's id space, in one place.
 *
 * Two sets, not two catalogues. `DECIDED` is what a spec *declares* — the
 * things a board has to schedule and an audit has to find. A test case id is
 * cited by a report and declared by nobody, so it belongs to the second set and
 * not the first: demanding a board task for every `TC-` would turn the coverage
 * finding into noise, and dropping it from what a report may cite would call a
 * cited case unreadable.
 */
const DECIDED = 'AC|RULE|EVN|JOB|UX-DR'
const CITED = `${DECIDED}|TC`

/** What a spec declares, and a board must schedule. */
const DECISION_ID = new RegExp(String.raw`\b(?:${DECIDED})-\d+\b`, 'g')
/** The same line, asked once, without the cursor a global regex carries. */
const NAMES_DECISION = new RegExp(String.raw`\b(?:${DECIDED})-\d+\b`)
/** A markdown heading — the other thing that ends a decision's text. */
const HEADING_LINE = /^\s{0,3}#{1,6}\s/

/** The two halves of a project-skill section: the template's, and the project's. */
const HEADING = /^## (.+)$/gm

/**
 * The half of a section the project wrote.
 *
 * A materialized section keeps its Shape half, and that half is full of example
 * ids — `AC-1`, `UX-DR-4` — that exist to show the format. Reading them as the
 * project's own decisions makes every fresh project fail with findings about a
 * spec nobody has written yet, which is the fastest way to teach someone to
 * ignore a gate.
 *
 * The project's half is the one under its own name: a template's `## {{PROJECT}}`
 * heading is materialized as `## acme`, and everything else in the file came
 * from the template. A file with no such heading contributes nothing.
 */
export function projectHalf(source: string, project: string): string {
	const headings = [
		...source.matchAll(HEADING),
	]

	for (const [index, heading] of headings.entries()) {
		if (heading[1].trim().toLowerCase() !== project.toLowerCase()) {
			continue
		}

		const start = (heading.index ?? 0) + heading[0].length

		return source.slice(start, headings[index + 1]?.index ?? source.length)
	}

	return ''
}

const BOARD_PAYLOAD =
	/<script type="application\/json" id="board">([\s\S]*?)<\/script>/

type Case = {
	id?: string
	level?: string
	proves?: string | null
	state?: string
	text?: string
}

export type Task = {
	cases?: Case[]
	casesApprovedBy?: string | null
	covers?: string[]
	id?: string
	report?: string | null
	status?: string
	title?: string
}

export type Board = {
	project?: string
	tasks?: Task[]
}

async function readJson<T>(
	context: CheckContext,
	file: string,
): Promise<T | undefined> {
	try {
		return JSON.parse(await context.read(file)) as T
	} catch {
		return undefined
	}
}

function labelOf(task: Task, index: number): string {
	return task.id ?? task.title ?? `task ${index + 1}`
}

/** Whether this project is one `turystack-harness` governs at all. */
export function isHarnessProject(context: CheckContext): boolean {
	return context.files.some((file) => UNDER_HARNESS.test(file))
}

function notHarness(id: string, context: CheckContext) {
	return isHarnessProject(context)
		? undefined
		: {
				id,
				state: 'skipped' as const,
				summary: 'not a harness project — nothing here to bootstrap',
				violations: [],
			}
}

/**
 * `HRN-1`, `HRN-4` — the project's own skills exist, and a board was derived
 * from them.
 *
 * Read from the disk on purpose. "The spec exists" is the belief that starts
 * most of the work that has to be redone, and it is held sincerely by whoever
 * says it.
 */
export const bootstrapComplete: Check = {
	id: 'bootstrap-complete',
	rules: [
		'HRN-1',
		'HRN-4',
	],
	async run(context: CheckContext) {
		const skipped = notHarness('bootstrap-complete', context)

		if (skipped) {
			return skipped
		}

		const violations: Violation[] = []
		const required: Array<
			[
				string,
				RegExp,
				string,
			]
		> = [
			[
				'a spec skill',
				SPEC_SKILL,
				'`turystack skills --skills spec` materializes it; `turystack-harness` fills it',
			],
			[
				'a UI/UX skill',
				UIUX_SKILL,
				'`turystack skills --skills uiux` materializes it; the design sweep fills it',
			],
			[
				'the project manifest',
				MANIFEST,
				're-run `turystack skills` — nothing else resolves the project skills by name',
			],
			[
				'a board',
				BOARD_STATE,
				'derive it from the spec — `turystack-harness` › `05-board.md`',
			],
		]

		for (const [what, pattern, how] of required) {
			if (!context.files.some((file) => pattern.test(file))) {
				violations.push({
					file: '.claude/',
					message: `the project has no ${what} — implementation runs on inputs that do not exist yet. ${how}`,
					rule: 'HRN-1',
				})
			}
		}

		return conclude(
			'bootstrap-complete',
			violations,
			required.length,
			'bootstrap input(s)',
		)
	},
}

/**
 * `HRN-8`, `UIX-17` — one theme per design system, and the index says which.
 *
 * The failure this catches is a theme file that exists and is served to nobody,
 * or an index row pointing at a file that was renamed. Both leave a design
 * system silently unthemed.
 */
export const themePerSystem: Check = {
	id: 'theme-per-system',
	rules: [
		'HRN-8',
		'UIX-17',
	],
	async run(context: CheckContext) {
		const themes = context.files.filter(isProjectTheme)
		const index = context.files.find((file) => THEME_INDEX.test(file))

		if (!index) {
			return conclude('theme-per-system', [], 0, 'theme index')
		}

		const source = await context.read(index)
		const violations: Violation[] = []

		for (const theme of themes) {
			const name = THEME.exec(theme)?.[2] ?? ''

			if (!source.includes(`${name}.css`)) {
				violations.push({
					file: theme,
					message: `not in the theme index — a theme nobody indexed is a design system nobody can tell an audience belongs to`,
					rule: 'UIX-17',
				})
			}
		}

		for (const match of stripFences(source).matchAll(
			/theme\/([\w.-]+)\.css/g,
		)) {
			// The index explains the reserved files as part of saying what they are
			// not. Reading those mentions as rows would report the documentation as
			// a missing design system.
			if (RESERVED_THEME.has(match[1])) {
				continue
			}

			const referenced = themes.some(
				(theme) => THEME.exec(theme)?.[2] === match[1],
			)

			if (!referenced) {
				violations.push({
					file: index,
					line: lineOf(source, match.index ?? 0),
					message: `the index names theme/${match[1]}.css and the file does not exist`,
					rule: 'UIX-17',
				})
			}
		}

		return conclude(
			'theme-per-system',
			violations,
			themes.length + 1,
			'theme file(s) and the index',
		)
	},
}

/** A theme this project wears, as opposed to one the skill ships to be read. */
function isProjectTheme(file: string): boolean {
	const name = THEME.exec(file)?.[2]

	return name !== undefined && !RESERVED_THEME.has(name)
}

/** Selectors a theme is allowed to scope with before the slot it overrides. */
const SCHEME_SCOPE = /^(?::root|html|body|\.dark|\.light|\[data-theme[^\]]*\])$/

/**
 * `UIX-18` — a theme overrides through the class a slot publishes.
 *
 * Two shapes are refused, and both are the same mistake at different depths: a
 * selector that reaches through a component's markup binds the project to an
 * arrangement the library may change in a patch release, and `!important` wins
 * the argument while hiding which rule was wrong.
 */
export const themeOverrideShape: Check = {
	id: 'theme-override-shape',
	rules: [
		'UIX-18',
	],
	async run(context: CheckContext) {
		const themes = context.files.filter((file) => THEME.test(file))
		const violations: Violation[] = []

		for (const theme of themes) {
			const raw = await context.read(theme)
			const source = raw.replace(/\/\*[\s\S]*?\*\//g, (block) =>
				'\n'.repeat(block.split('\n').length - 1),
			)

			for (const match of source.matchAll(/!important/g)) {
				violations.push({
					file: theme,
					line: lineOf(source, match.index ?? 0),
					message:
						'`!important` in a theme — it wins this argument and hides which rule was actually wrong',
					rule: 'UIX-18',
				})
			}

			for (const match of source.matchAll(/(^|[{};])([^{};@]+)\{/g)) {
				// Past the leading blank lines: a selector's line is where its
				// text starts, not where the previous rule closed.
				const offset =
					(match.index ?? 0) +
					match[1].length +
					(/^\s*/.exec(match[2])?.[0].length ?? 0)

				for (const selector of match[2].split(',')) {
					const problem = offendingSelector(selector)

					if (problem) {
						violations.push({
							file: theme,
							line: lineOf(source, offset),
							message: `${problem} — a theme overrides through the class a slot publishes, never through the markup around it`,
							rule: 'UIX-18',
						})
					}
				}
			}
		}

		return conclude(
			'theme-override-shape',
			violations,
			themes.length,
			'theme file(s)',
		)
	},
}

/** What is wrong with one selector, or nothing when it is a slot override. */
export function offendingSelector(selector: string): string | undefined {
	const trimmed = selector.trim()

	if (trimmed === '' || trimmed.startsWith('@') || trimmed.startsWith('%')) {
		return undefined
	}

	if (/[>+~]/.test(trimmed)) {
		return `\`${trimmed}\` combines elements structurally`
	}

	const parts = trimmed.split(/\s+/)

	if (parts.length > 2) {
		return `\`${trimmed}\` descends ${parts.length} levels into the markup`
	}

	if (parts.length === 2 && !SCHEME_SCOPE.test(parts[0])) {
		return `\`${trimmed}\` reaches through \`${parts[0]}\`, which is not a colour-scheme scope`
	}

	const target = parts[parts.length - 1]

	if (/^[a-zA-Z]/.test(target) && !SCHEME_SCOPE.test(target)) {
		return `\`${target}\` is a type selector — it styles the library's markup rather than a published slot`
	}

	return undefined
}

/**
 * `UIX-19` — the application's copy of a theme still matches this skill's.
 *
 * A copy is the only way to get the file into an application's build, and a
 * copy nobody compares is a copy that already drifted. When the applications
 * live elsewhere the comparison cannot run here, and the check says so rather
 * than passing.
 */
export const themeInSync: Check = {
	id: 'theme-in-sync',
	rules: [
		'UIX-19',
	],
	async run(context: CheckContext) {
		const themes = context.files.filter(isProjectTheme)
		const violations: Violation[] = []
		let compared = 0

		for (const theme of themes) {
			const name = `${THEME.exec(theme)?.[2]}.css`
			const copies = context.files.filter(
				(file) => file !== theme && file.endsWith(`/${name}`),
			)

			if (copies.length === 0) {
				continue
			}

			const original = await context.read(theme)

			for (const copy of copies) {
				compared += 1

				if ((await context.read(copy)) !== original) {
					violations.push({
						file: copy,
						message: `differs from ${theme} — one of the two is what the product looks like, and nothing says which`,
						rule: 'UIX-19',
					})
				}
			}
		}

		return conclude('theme-in-sync', violations, compared, 'theme copy(ies)')
	},
}

/**
 * A value as text, with object keys in a fixed order.
 *
 * The page and the state are written by the same step and read by two different
 * parsers, and a key order that happens to differ is not a difference anybody
 * needs to hear about.
 */
export function canonical(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonical).join(',')}]`
	}

	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(',')}}`
	}

	return JSON.stringify(value) ?? 'null'
}

export async function readBoard(context: CheckContext): Promise<
	| {
			board: Board
			file: string
	  }
	| undefined
> {
	const file = context.files.find((candidate) => BOARD_STATE.test(candidate))

	if (!file) {
		return undefined
	}

	const board = await readJson<Board>(context, file)

	return board
		? {
				board,
				file,
			}
		: undefined
}

/** An id the project declared, and the text it was declared in. */
export type Declaration = {
	/** Where it was first seen, for a violation that has to point somewhere. */
	file: string
	/** Every line, in file order, that names it — the decision's stated text. */
	lines: string[]
}

/**
 * Every id the project's own skills declare, with the text that carries it.
 *
 * One scan, one catalogue. Two callers ask different questions of it — "is this
 * scheduled?" and "has it moved since it was proved?" — and a second scan
 * written for the second question would drift from the first the moment either
 * regex is touched.
 *
 * The lines are collected from every file that names the id rather than only
 * the one that declared it. A criterion restated in the UI/UX skill is part of
 * what the id means, and the direction of the error matters: hashing too much
 * re-audits something that did not need it, hashing too little calls a moved
 * decision proved.
 *
 * The unit is the **block**, not the line: the line that names the id plus
 * everything under it until the next heading or the next line naming another
 * id. A spec written as a table gets one row per decision, because the next row
 * ends the block; a spec written as `### AC-4` followed by three paragraphs gets
 * all three, because nothing ends it until the next id. Hashing only the line
 * would let the prose under a heading be rewritten with no digest moving, which
 * is the one direction of error this must not have.
 */
export async function declaredIds(
	context: CheckContext,
): Promise<Map<string, Declaration>> {
	const declared = new Map<string, Declaration>()

	for (const file of context.files) {
		const skill = SPEC_SKILL.exec(file)?.[1] ?? UIUX_SKILL.exec(file)?.[1]

		if (!skill || !file.endsWith('.md')) {
			continue
		}

		// `acme-spec` and `acme-uiux` are both `acme`'s, and the heading the
		// project fills carries exactly that name.
		const project = skill.replace(/-(?:spec|uiux)$/, '')
		const source = projectHalf(stripFences(await context.read(file)), project)

		const lines = source.split('\n')

		for (const [index, line] of lines.entries()) {
			const ids = new Set(
				[
					...line.matchAll(DECISION_ID),
				].map(([id]) => id),
			)

			if (ids.size === 0) {
				continue
			}

			const block: string[] = []

			for (let cursor = index; cursor < lines.length; cursor += 1) {
				const text = lines[cursor]

				if (
					cursor > index &&
					(HEADING_LINE.test(text) || NAMES_DECISION.test(text))
				) {
					break
				}

				if (text.trim() !== '') {
					block.push(text.trim())
				}
			}

			for (const id of ids) {
				const found = declared.get(id)

				if (found) {
					found.lines.push(...block)
				} else {
					declared.set(id, {
						file,
						lines: [
							...block,
						],
					})
				}
			}
		}
	}

	return declared
}

/**
 * `SPC-17`, `HRN-16` — the board and the spec cover each other.
 *
 * Both directions matter and they catch different things. An id no task names
 * is a decision nobody scheduled, and it is almost always an unhappy path — the
 * criteria for "not allowed" and "already done" get written and then never
 * appear on a board. A task naming no id is work nobody asked for.
 */
export const boardCoversSpec: Check = {
	id: 'board-covers-spec',
	rules: [
		'SPC-17',
		'HRN-16',
	],
	async run(context: CheckContext) {
		const found = await readBoard(context)

		if (!found) {
			return conclude('board-covers-spec', [], 0, 'board')
		}

		const declared = await declaredIds(context)
		const tasks = found.board.tasks ?? []
		const covered = new Set(tasks.flatMap((task) => task.covers ?? []))
		const violations: Violation[] = []

		for (const [index, task] of tasks.entries()) {
			if ((task.covers ?? []).length === 0) {
				violations.push({
					file: found.file,
					message: `${labelOf(task, index)} names no id — a task that satisfies nothing the spec declares cannot be audited, only believed`,
					rule: 'SPC-17',
				})
			}
		}

		for (const [id, declaration] of declared) {
			if (!covered.has(id)) {
				violations.push({
					file: declaration.file,
					message: `${id} is declared and no task on the board names it — decided work nobody scheduled`,
					rule: 'SPC-17',
				})
			}
		}

		return conclude(
			'board-covers-spec',
			violations,
			declared.size + tasks.length,
			'id(s) and task(s)',
		)
	},
}

/**
 * `SPC-16` — the page is a render of the state, not a second copy of it.
 *
 * The page carries the payload so it opens with no server, the same way the
 * delivery report does. That is only safe while one of the two is authoritative,
 * and a page edited by hand is a change whose history is a diff of markup.
 */
export const boardInSync: Check = {
	id: 'board-in-sync',
	rules: [
		'SPC-16',
	],
	async run(context: CheckContext) {
		const found = await readBoard(context)
		const page = context.files.find((file) => BOARD_PAGE.test(file))

		if (!found || !page) {
			return conclude('board-in-sync', [], 0, 'board page')
		}

		const payload = BOARD_PAYLOAD.exec(await context.read(page))
		const violations: Violation[] = []

		if (!payload) {
			violations.push({
				file: page,
				message:
					'no #board payload — the page renders nothing, and the board opens empty for whoever inherits it',
				rule: 'SPC-16',
			})
		} else {
			let rendered: string | undefined

			try {
				rendered = canonical(JSON.parse(payload[1]))
			} catch {
				rendered = undefined
			}

			if (rendered === undefined) {
				violations.push({
					file: page,
					message: 'the #board payload is not valid JSON',
					rule: 'SPC-16',
				})
			} else if (rendered !== canonical(found.board)) {
				violations.push({
					file: page,
					message: `the page shows something ${found.file} does not say — it is a render of that file, written in the same step that changes it`,
					rule: 'SPC-16',
				})
			}
		}

		return conclude('board-in-sync', violations, 1, 'board page')
	},
}

/**
 * `SPC-18` — `done` means a report exists, and it is where the task says it is.
 *
 * Without this, `done` is a word somebody typed. The status and the evidence are
 * written by different steps, and only one of them is hard to fake.
 */
export const boardReportLinked: Check = {
	id: 'board-report-linked',
	rules: [
		'SPC-18',
	],
	async run(context: CheckContext) {
		const found = await readBoard(context)

		if (!found) {
			return conclude('board-report-linked', [], 0, 'board')
		}

		const directory = found.file.slice(0, found.file.lastIndexOf('/'))
		const done = (found.board.tasks ?? []).filter(
			(task) => task.status === 'done',
		)
		const violations: Violation[] = []

		for (const [index, task] of done.entries()) {
			const report = task.report ?? ''

			if (report === '') {
				violations.push({
					file: found.file,
					message: `${labelOf(task, index)} is done with no report — a status nothing produced is a claim`,
					rule: 'SPC-18',
				})
				continue
			}

			const exists = context.files.some(
				(file) => file === report || file === `${directory}/${report}`,
			)

			if (!exists) {
				violations.push({
					file: found.file,
					message: `${labelOf(task, index)} points at ${report}, which is not in the repository — the evidence is where the task says it is, or it is nowhere`,
					rule: 'SPC-18',
				})
			}
		}

		return conclude(
			'board-report-linked',
			violations,
			done.length,
			'delivered task(s)',
		)
	},
}

type Spec = {
	spec?: string
	test?: string
}

type Report = {
	backend?: {
		specs?: Spec[]
	}
	frontend?: {
		specs?: Spec[]
	}
	task?: {
		covers?: string[]
		id?: string
	}
}

const REPORT = /(?:^|\/)gate-report\.json$/
const ID_IN_SPEC = new RegExp(String.raw`\b(?:${CITED})-\d+\b`, 'g')

/**
 * `HRN-15`, `HRN-20`, `SPC-19`, `DLV-16` — the report can be read by id.
 *
 * A report that lists twenty green tests and cites no id answers "did anything
 * break" and never "was this criterion implemented". The second question is the
 * only one an audit asks, and six months later it is the only one anybody
 * remembers to ask.
 */
export const ruleIdCoverage: Check = {
	id: 'rule-id-coverage',
	rules: [
		'HRN-15',
		'HRN-20',
		'SPC-19',
		'DLV-16',
	],
	async run(context: CheckContext) {
		const file = context.files.find((candidate) => REPORT.test(candidate))

		if (!file) {
			return {
				id: 'rule-id-coverage',
				state: 'skipped' as const,
				summary:
					'no gate-report.json yet — this check runs on the report a task emits',
				violations: [],
			}
		}

		const report = await readJson<Report>(context, file)

		if (!report) {
			return {
				id: 'rule-id-coverage',
				state: 'fail' as const,
				summary: 'gate-report.json is not valid JSON',
				violations: [],
			}
		}

		const specs = [
			...(report.backend?.specs ?? []),
			...(report.frontend?.specs ?? []),
		]
		const violations: Violation[] = []
		const proved = new Set<string>()

		for (const entry of specs) {
			const text = entry.spec ?? ''
			const ids = [
				...text.matchAll(ID_IN_SPEC),
			].map(([id]) => id)

			if (ids.length === 0) {
				violations.push({
					file,
					message: `"${text}" cites no id — an audit has nothing to match it against in the spec`,
					rule: 'DLV-16',
				})
				continue
			}

			for (const id of ids) {
				proved.add(id)
			}
		}

		for (const id of report.task?.covers ?? []) {
			if (!proved.has(id)) {
				violations.push({
					file,
					message: `the task claims ${id} and no spec in this report cites it — claimed is not proved`,
					rule: 'DLV-16',
				})
			}
		}

		return conclude(
			'rule-id-coverage',
			violations,
			specs.length,
			'spec(s) in the report',
		)
	},
}

/**
 * A task that is being built, or was built.
 *
 * `blocked` is deliberately not here. A task blocks for reasons that happen
 * before anyone reads its cases — a silent spec, a missing slot in the library
 * — and demanding an approval there would teach people to sign the list to
 * clear a finding, which is the one outcome this check exists to prevent.
 */
const STARTED = new Set([
	'doing',
	'done',
])

/**
 * `SPC-21`, `HRN-22` — a task carries its cases before it carries any code.
 *
 * The cases are the only part of a task a non-engineer can check, and they are
 * only worth checking while they can still change anything. Written afterwards
 * they describe the implementation, which the implementation already does, more
 * accurately.
 */
export const taskCases: Check = {
	id: 'task-cases',
	rules: [
		'SPC-21',
		'HRN-22',
	],
	async run(context: CheckContext) {
		const found = await readBoard(context)

		if (!found) {
			return conclude('task-cases', [], 0, 'board')
		}

		const tasks = found.board.tasks ?? []
		const violations: Violation[] = []

		for (const [index, task] of tasks.entries()) {
			const cases = task.cases ?? []
			const where = labelOf(task, index)

			if (cases.length === 0) {
				violations.push({
					file: found.file,
					message: `${where} has no cases — what gets tested would be decided during implementation, by whoever is typing`,
					rule: 'SPC-21',
				})
				continue
			}

			for (const entry of cases) {
				if (!entry.id) {
					violations.push({
						file: found.file,
						message: `${where} has a case with no id — the report has nothing to list it under`,
						rule: 'SPC-21',
					})
				}

				if (!entry.text) {
					violations.push({
						file: found.file,
						message: `${where} · ${entry.id ?? 'a case'} says nothing — a case nobody can read is not reviewable`,
						rule: 'SPC-21',
					})
				}

				if (!entry.level) {
					violations.push({
						file: found.file,
						message: `${where} · ${entry.id ?? 'a case'} names no level — where something is proved is a decision, and it is cheaper here than at review`,
						rule: 'SPC-21',
					})
				}
			}
		}

		return conclude('task-cases', violations, tasks.length, 'task(s)')
	},
}

/**
 * `SPC-22`, `HRN-23` — a person read the cases before the code was written.
 *
 * This is the cheapest stop in the flow and the one with the highest return: the
 * cases a person adds are never the ones an agent would write. It only holds
 * while it is checked, because approving is invisible and skipping it looks
 * exactly like being efficient.
 */
export const casesApproved: Check = {
	id: 'cases-approved',
	rules: [
		'SPC-22',
		'HRN-23',
	],
	async run(context: CheckContext) {
		const found = await readBoard(context)

		if (!found) {
			return conclude('cases-approved', [], 0, 'board')
		}

		const started = (found.board.tasks ?? []).filter((task) =>
			STARTED.has(task.status ?? 'open'),
		)
		const violations: Violation[] = []

		for (const [index, task] of started.entries()) {
			const where = labelOf(task, index)

			if (!task.casesApprovedBy) {
				violations.push({
					file: found.file,
					message: `${where} is ${task.status} and nobody signed its cases — implementation started on a list nobody read`,
					rule: 'SPC-22',
				})
			}

			for (const entry of task.cases ?? []) {
				if (entry.state !== 'approved') {
					violations.push({
						file: found.file,
						message: `${where} · ${entry.id ?? 'a case'} is still '${entry.state ?? 'unset'}' while the task is ${task.status}`,
						rule: 'SPC-22',
					})
				}
			}
		}

		return conclude(
			'cases-approved',
			violations,
			started.length,
			'started task(s)',
		)
	},
}

/**
 * `DLV-17` — every approved case reached a test, and the report says which.
 *
 * The case most likely to disappear between approval and delivery is the one
 * that was hardest to write a test for, which is the one that was worth the
 * most. Nothing about a green report shows the gap: the tests that exist all
 * pass, and the one that was dropped leaves no trace anywhere but here.
 */
export const caseTestLink: Check = {
	id: 'case-test-link',
	rules: [
		'DLV-17',
	],
	async run(context: CheckContext) {
		const file = context.files.find((candidate) => REPORT.test(candidate))
		const found = await readBoard(context)

		if (!file || !found) {
			return conclude('case-test-link', [], 0, 'report and board')
		}

		const report = await readJson<Report>(context, file)
		const task = (found.board.tasks ?? []).find(
			(candidate) => candidate.id === report?.task?.id,
		)

		if (!report || !task) {
			return conclude('case-test-link', [], 0, 'board task for this report')
		}

		const specs = [
			...(report.backend?.specs ?? []),
			...(report.frontend?.specs ?? []),
		]
		const approved = (task.cases ?? []).filter(
			(entry) => entry.state === 'approved',
		)
		const violations: Violation[] = []

		for (const entry of approved) {
			const proved = specs.find(
				(spec) => entry.id && (spec.spec ?? '').includes(entry.id),
			)

			if (!proved) {
				violations.push({
					file,
					message: `${entry.id ?? 'a case'} was approved and this report proves nothing under it — "${entry.text ?? ''}"`,
					rule: 'DLV-17',
				})
				continue
			}

			if (!proved.test) {
				violations.push({
					file,
					message: `${entry.id} is listed with no test — a spec with no test is a requirement nobody proved`,
					rule: 'DLV-17',
				})
			}
		}

		return conclude(
			'case-test-link',
			violations,
			approved.length,
			'approved case(s)',
		)
	},
}

/**
 * Everything about a board page except the board in it.
 *
 * The example is the template with data — that is the only reason it can be
 * trusted as documentation. Comparing them means normalising the three things
 * that are *meant* to differ: the payload, the start-here comment the template
 * still carries, and the project's name in the title.
 */
export function pageShell(source: string): string {
	return source
		.replace(
			BOARD_PAYLOAD,
			'<script type="application/json" id="board"></script>',
		)
		.replace(/[^\S\n]*<!--\s*turystack:howto[\s\S]*?-->\n?/g, '')
		.replace(/<title>[^<]*<\/title>/, '<title></title>')
		.trim()
}

/**
 * `SPC-23` — the example board is the template with a payload in it.
 *
 * Two copies of a page drift in one direction: the one somebody opens gets
 * fixed, and the one shipped as documentation keeps the bug. Here the shipped
 * one *is* the documentation, so the drift would be invisible until a reader
 * built something from a page the product no longer has.
 */
export const examplePageCurrent: Check = {
	id: 'example-page-current',
	rules: [
		'SPC-23',
	],
	async run(context: CheckContext) {
		const template = context.files.find((file) => BOARD_TEMPLATE.test(file))
		const example = context.files.find((file) => BOARD_EXAMPLE.test(file))

		if (!template || !example) {
			return conclude('example-page-current', [], 0, 'example board page')
		}

		const violations: Violation[] = []

		if (
			pageShell(await context.read(template)) !==
			pageShell(await context.read(example))
		) {
			violations.push({
				file: example,
				message: `differs from ${template} outside its payload — the example is that page with data in it, and a reader cannot tell which of the two the product actually has`,
				rule: 'SPC-23',
			})
		}

		const payload = BOARD_PAYLOAD.exec(await context.read(example))

		if (payload && (payload[1] ?? '').trim() === '') {
			violations.push({
				file: example,
				message:
					'has no board in it — an example board with no tasks teaches nothing the empty template did not',
				rule: 'SPC-23',
			})
		}

		return conclude('example-page-current', violations, 1, 'example board page')
	},
}

export const HARNESS_CHECKS: Check[] = [
	boardCoversSpec,
	boardInSync,
	boardReportLinked,
	bootstrapComplete,
	caseTestLink,
	casesApproved,
	examplePageCurrent,
	ruleIdCoverage,
	taskCases,
	themeInSync,
	themeOverrideShape,
	themePerSystem,
]
