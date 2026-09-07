import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { Violation } from '@/types.js'

import { lineOf } from '@/checks/conclude.js'

/**
 * What a skill package must be true about **itself**.
 *
 * The monorepo validator checks everything at once: cross-skill citations, the
 * global gate coverage, the CLI's install map. None of that is available to a
 * published skill's own CI, which sees one directory — so until now a skill
 * shipped with nothing checking it, and a malformed table or a duplicated id
 * reached consumers.
 *
 * This is the subset a skill can answer alone, and it is not a small one:
 * a mangled separator row silently swallows a law when the markdown renders,
 * and that is exactly the defect that has to be caught before publish rather
 * than by a reader who happens to notice a law is gone.
 */

const ID_HEADER = /^\| ID \| /
const SEPARATOR = /^\|[\s|:-]+\|$/
/** A de-para block: retired ids inside it are expected to resolve to nothing. */
const MIGRATION_BLOCK =
	/`?[A-Z]{2,4}-L?\d+`?\s*→|\| Was \| Now|\bretired\b|\bbecame\b/

/**
 * A law that belongs to a sibling skill, cited by naming its owner.
 *
 * Whether that skill really defines it is a cross-skill question, and this
 * command sees one directory — the monorepo's validator resolves the claim.
 * What is checked here is that the citation names an owner at all, which is the
 * difference between a reference and a dangling id.
 */
const FOREIGN_ID = /`turystack-[\w-]+`\s*›\s*`([A-Z]{2,4}-L?\d+)`/g

const LAW_ROW = /^\| ((?:ARC-[A-Z]{2,4}-\d+)|(?:[A-Z]{2,4}-L?\d+)) \| /
const GATE_TOKEN = /^`(?:(?:biome|grit|gate|test):[\w:-]+|manual)`$/

/**
 * A law names its detectors in one cell, and it may name more than one:
 * `CMP-2` is held up by `gate:barrel-shape` for what a barrel exports and by
 * `gate:contract-sync` for how a consumer imports it.
 *
 * Read per cell, with every `·`-separated piece required to be a token. Testing
 * the whole row for a token *anywhere* — which is what this did — also accepts
 * a gate name mentioned in the Law column by a row that binds nothing, and the
 * repository's other validator, `scripts/validate-skills.mjs`, reads it the
 * strict way. Two readings of one rule is a disagreement waiting to be found by
 * whoever writes the row that falls between them.
 */
function namesGate(row: string): boolean {
	return row
		.replace(/\\\|/g, '@')
		.split('|')
		.some((cell) => {
			const pieces = cell
				.trim()
				.split('·')
				.map((piece) => piece.trim())
				.filter(Boolean)

			return (
				pieces.length > 0 && pieces.every((piece) => GATE_TOKEN.test(piece))
			)
		})
}
const CLASS_CELL = /\|\s*(constitutional|stack lint)\s*\|/

export type SkillReport = {
	laws: number
	name: string
	sections: number
	violations: Violation[]
}

/** Columns a markdown table row declares, ignoring the outer pipes. */
export function columnsOf(row: string): number {
	return row
		.trim()
		.replace(/^\||\|$/g, '')
		.split('|').length
}

/**
 * A header and its separator must agree on width.
 *
 * When they do not, every renderer drops or merges cells, and a law disappears
 * from the page while staying in the file — the worst possible failure for a
 * document whose whole purpose is to be read.
 */
export function tableProblems(source: string): Array<{
	line: number
	message: string
}> {
	const problems: Array<{
		line: number
		message: string
	}> = []
	const lines = source.split('\n')

	for (const [index, line] of lines.entries()) {
		if (!ID_HEADER.test(line)) {
			continue
		}

		const separator = lines[index + 1] ?? ''

		if (!SEPARATOR.test(separator)) {
			problems.push({
				line: index + 2,
				message:
					'the row under an ID header is not a separator — the table will not render as a table',
			})
			continue
		}

		if (columnsOf(separator) !== columnsOf(line)) {
			problems.push({
				line: index + 2,
				message: `separator declares ${columnsOf(separator)} columns, header declares ${columnsOf(line)} — cells are dropped or merged when this renders`,
			})
		}
	}

	return problems
}

export type LawRow = {
	hasClassColumn: boolean
	id: string
	line: number
	text: string
}

/**
 * The law rows of a file, read as rows of *their own table*.
 *
 * Scanning line by line for `| SOME-ID |` looks equivalent and is not. Two real
 * cases break it, and both were found the first time this ran:
 *
 * - `00-overview.md` carries a renamed-ids migration table whose rows also open
 *   with an id. They are not laws, and demanding a gate and a class of them
 *   produced findings with nothing to fix.
 * - not every skill's law table has a Class column. The primitives skill uses
 *   `| ID | Law (one line) | Gate |`, so requiring a class there reported sixty
 *   three violations of a rule that skill never adopted.
 *
 * So the header decides: a table is a law table when it opens with `ID` and
 * declares a `Law` column, and what is required of its rows is what its own
 * header declares.
 */
export function lawRows(source: string): LawRow[] {
	const rows: LawRow[] = []
	const lines = source.split('\n')
	let header:
		| {
				hasClass: boolean
		  }
		| undefined

	for (const [index, line] of lines.entries()) {
		if (/^\|\s*ID\s*\|/.test(line)) {
			header = /^\|\s*ID\s*\|\s*Law/i.test(line)
				? {
						hasClass: /\|\s*Class\s*\|/i.test(line),
					}
				: undefined
			continue
		}

		if (!line.startsWith('|')) {
			header = undefined
			continue
		}

		if (!header || SEPARATOR.test(line)) {
			continue
		}

		const match = LAW_ROW.exec(line)

		if (match) {
			rows.push({
				hasClassColumn: header.hasClass,
				id: match[1],
				line: index + 1,
				text: line,
			})
		}
	}

	return rows
}

async function sectionsOf(directory: string): Promise<string[]> {
	const entries = await readdir(directory, {
		withFileTypes: true,
	})

	return entries
		.filter((entry) => entry.isFile() && /^\d{2}-.+\.md$/.test(entry.name))
		.map((entry) => entry.name)
		.sort()
}

export async function inspectSkill(directory: string): Promise<SkillReport> {
	const violations: Violation[] = []
	const manifest = join(directory, 'SKILL.md')

	let name = basename(directory)

	const source = await readFile(manifest, 'utf8').catch(() => '')

	if (source === '') {
		violations.push({
			file: 'SKILL.md',
			message:
				'no SKILL.md — nothing tells an agent what this skill is or when to reach for it',
			rule: 'SKILL',
		})
	} else {
		const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)

		if (!frontmatter) {
			violations.push({
				file: 'SKILL.md',
				message:
					'no frontmatter — `name` and `description` are how the skill is found at all',
				rule: 'SKILL',
			})
		} else {
			const declared = /^name:\s*"?([^"\n]+)"?/m.exec(frontmatter[1])

			if (declared) {
				name = declared[1].trim()
			} else {
				violations.push({
					file: 'SKILL.md',
					message: 'frontmatter declares no name',
					rule: 'SKILL',
				})
			}

			if (!/^description:\s*\S/m.test(frontmatter[1])) {
				violations.push({
					file: 'SKILL.md',
					message:
						'frontmatter declares no description — the description is the only thing read when deciding whether to load this skill',
					rule: 'SKILL',
				})
			}
		}
	}

	/**
	 * The README is the skill's own contents page, and it drifts silently.
	 *
	 * These two checks came from a `check-skill.mjs` that shipped in all seven
	 * skill packages — seven byte-identical copies, in nobody's CI and in no
	 * package's `files`. I replaced it with this command without reading what it
	 * did, and dropped three checks doing it. They are back, in one place.
	 */
	const sections = await sectionsOf(directory)
	const readme = await readFile(join(directory, 'README.md'), 'utf8').catch(
		() => '',
	)

	if (readme !== '') {
		const linked = new Set(
			[
				...readme.matchAll(/\]\(([\w.-]+\.md)\)/g),
			].map((match) => match[1]),
		)

		for (const file of sections) {
			if (!linked.has(file)) {
				violations.push({
					file: 'README.md',
					message: `${file} ships and the README does not list it — a section nobody links is a section nobody opens`,
					rule: 'README',
				})
			}
		}

		for (const file of linked) {
			if (
				file !== 'README.md' &&
				file !== 'SKILL.md' &&
				!sections.includes(file)
			) {
				violations.push({
					file: 'README.md',
					message: `links ${file}, which this skill does not ship`,
					rule: 'README',
				})
			}
		}
	}

	const seen = new Map<string, string>()
	const cited = new Map<
		string,
		{
			file: string
			line: number
		}
	>()
	/** Ids this skill declared as a sibling's, once, by naming the owner. */
	const foreign = new Set<string>()
	let laws = 0

	for (const section of sections) {
		const text = await readFile(join(directory, section), 'utf8')

		for (const [, id] of text.matchAll(FOREIGN_ID)) {
			foreign.add(id)
		}

		for (const problem of tableProblems(text)) {
			violations.push({
				file: section,
				line: problem.line,
				message: problem.message,
				rule: 'TABLE',
			})
		}

		/**
		 * A local id cited and never defined is a review citing a law that does
		 * not exist.
		 *
		 * `ARC-…` tokens are removed first rather than filtered after, because
		 * `\b` matches inside them: the scan reads `CTR-1` out of `ARC-CTR-1` and
		 * reports a law the constitution owns as missing from this skill. The
		 * same collision bit `UX-DR-4` → `DR-4` in the root validator.
		 */
		const local = text
			.replace(/\bARC-[A-Z]{2,4}-\d+\b/g, '')
			.replace(/\b(?:UX-DR-\d+|AC-\d+|RULE-\d+|EVN-\d+|JOB-\d+|TC-\d+)\b/g, '')
			.split(/\n\s*\n/)
			// A block that maps an old id to a new one documents history, not law:
			// its retired ids are meant to resolve to nothing. Same exclusion the
			// root validator makes, for the same reason.
			.filter((block) => !MIGRATION_BLOCK.test(block))
			.join('\n\n')

		for (const match of local.matchAll(/\b([A-Z]{2,4}-L?\d+)\b/g)) {
			if (!cited.has(match[1])) {
				cited.set(match[1], {
					file: section,
					line: lineOf(local, match.index ?? 0),
				})
			}
		}

		for (const row of lawRows(text)) {
			laws += 1
			const first = seen.get(row.id)

			if (first) {
				violations.push({
					file: section,
					line: row.line,
					message: `${row.id} is defined twice — first in ${first}. A review that cites it would be citing two different laws`,
					rule: 'ID',
				})
			} else {
				seen.set(row.id, section)
			}

			if (!namesGate(row.text)) {
				violations.push({
					file: section,
					line: row.line,
					message: `${row.id} names no gate — every law says what checks it, even when the answer is \`manual\``,
					rule: 'GATE',
				})
			}

			if (row.hasClassColumn && !CLASS_CELL.test(row.text)) {
				violations.push({
					file: section,
					line: row.line,
					message: `${row.id} declares no class — a law is 'constitutional' or 'stack lint', and the difference decides who may change it`,
					rule: 'CLASS',
				})
			}
		}
	}

	for (const [id, where] of cited) {
		if (seen.has(id) || id.startsWith('ARC-') || foreign.has(id)) {
			continue
		}

		violations.push({
			file: where.file,
			line: where.line,
			message: `${id} is cited here and defined nowhere in this skill — a review citing it would be citing nothing`,
			rule: 'ID',
		})
	}

	if (sections.length === 0) {
		violations.push({
			file: '.',
			message:
				'no numbered section — a skill with only a SKILL.md has nothing to progressively disclose',
			rule: 'SKILL',
		})
	}

	return {
		laws,
		name,
		sections: sections.length,
		violations,
	}
}
