import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { columnsOf, inspectSkill, lawRows, tableProblems } from '@/skill.js'

/**
 * The separator check earns its own tests because it caught a real defect: a
 * script that rewrote law tables left several separators one column short, and
 * every renderer quietly merged cells from that row down. Nothing failed. The
 * laws were simply not on the page any more.
 */
describe('a law table renders as a table @skill-tables', () => {
	const header = '| ID | Law | Class | Gate |'

	it('counts the columns a row declares', () => {
		expect(columnsOf(header)).toBe(4)
		expect(columnsOf('|---|---|---|---|')).toBe(4)
	})

	it('accepts a header whose separator agrees with it', () => {
		expect(
			tableProblems(
				`${header}\n|---|---|---|---|\n| ARC-A-1 | x | constitutional | \`manual\` |`,
			),
		).toEqual([])
	})

	it('refuses a separator that is one column short', () => {
		const problems = tableProblems(`${header}\n|---|---|---|`)

		expect(problems).toHaveLength(1)
		expect(problems[0].message).toContain('3 columns')
	})

	it('refuses a header with no separator under it', () => {
		const problems = tableProblems(
			`${header}\n| ARC-A-1 | x | constitutional | \`manual\` |`,
		)

		expect(problems).toHaveLength(1)
		expect(problems[0].message).toContain('not a separator')
	})

	it('ignores tables that are not law tables', () => {
		expect(tableProblems('| Input | Answers |\n|---|---|')).toEqual([])
	})
})

/**
 * Reading rows without reading their header is the mistake this replaced, and
 * it was not theoretical: it reported sixty three violations against a skill
 * whose law tables have no Class column, and demanded a gate of a migration
 * table whose rows merely start with an id.
 */
describe('a law row belongs to a law table @skill-rows', () => {
	const lawTable = [
		'| ID | Law | Class | Gate |',
		'|---|---|---|---|',
		'| ARC-CON-1 | one | constitutional | `manual` |',
	].join('\n')

	it('reads the rows of a law table', () => {
		const rows = lawRows(lawTable)

		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe('ARC-CON-1')
		expect(rows[0].hasClassColumn).toBe(true)
	})

	it('does not require a class the table never declared', () => {
		const rows = lawRows(
			[
				'| ID | Law (one line) | Gate |',
				'|---|---|---|',
				'| AXS-L1 | one | `manual` |',
			].join('\n'),
		)

		expect(rows).toHaveLength(1)
		expect(rows[0].hasClassColumn).toBe(false)
	})

	it('ignores a migration table whose rows open with an id', () => {
		const migration = [
			'| Old | New | Why |',
			'|---|---|---|',
			'| BE-10 | `PRJ-L1` | stack lint, so it stayed here |',
		].join('\n')

		expect(lawRows(migration)).toEqual([])
	})

	it('stops reading at the end of the table', () => {
		const after = `${lawTable}\n\nSome prose.\n\n| ARC-CON-9 | loose | row |`

		expect(lawRows(after).map((row) => row.id)).toEqual([
			'ARC-CON-1',
		])
	})
})

/**
 * A law that belongs to a sibling skill.
 *
 * Three of these lived in the repository as prose — "`CTL-8` in the backend
 * skill" — and read to this check exactly like a citation of nothing. The fix
 * is not silence: naming the owner is what lets the monorepo's validator go and
 * confirm that skill really defines it.
 */
describe("citing a sibling skill's law @skill-foreign", () => {
	const directories: string[] = []

	async function skillWith(citation: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), 'turystack-skill-'))
		directories.push(directory)

		await writeFile(
			join(directory, 'SKILL.md'),
			'---\nname: "turystack-example"\ndescription: "x"\n---\n',
			'utf8',
		)
		await writeFile(
			join(directory, '00-overview.md'),
			[
				'# Example',
				'',
				'| ID | Law | Class | Gate |',
				'|---|---|---|---|',
				'| EXA-1 | a law of this skill | constitutional | `manual` |',
				'',
				`Prose citing ${citation}, and \`EXA-1\` of its own.`,
			].join('\n'),
			'utf8',
		)

		return directory
	}

	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) =>
				rm(directory, {
					force: true,
					recursive: true,
				}),
			),
		)
	})

	it('accepts an id whose owner is named', async () => {
		const report = await inspectSkill(
			await skillWith('`turystack-backend-pattern` › `CTL-8`'),
		)

		expect(report.violations).toEqual([])
	})

	it('still refuses one that names nobody', async () => {
		const report = await inspectSkill(await skillWith('`CTL-8`'))

		expect(report.violations).toHaveLength(1)
		expect(report.violations[0].message).toContain('defined nowhere')
	})
})
