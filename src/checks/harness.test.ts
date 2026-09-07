import { describe, expect, it } from 'vitest'

import { canonical, offendingSelector, projectHalf } from '@/checks/harness.js'

describe('UIX-18 · a theme overrides through a published slot', () => {
	const allowed = [
		':root',
		'.button',
		'.dark .button',
		'[data-theme="dark"] .table',
		'.button[data-variant="destructive"]',
		'.dark',
	]

	for (const selector of allowed) {
		it(`allows ${selector}`, () => {
			expect(offendingSelector(selector)).toBeUndefined()
		})
	}

	it('refuses a child combinator', () => {
		expect(offendingSelector('.card > div')).toMatch(/structurally/)
	})

	it('refuses reaching through a component the theme does not own', () => {
		expect(offendingSelector('.card .row .cell')).toMatch(/descends/)
		expect(offendingSelector('.card .cell')).toMatch(/reaches through/)
	})

	it('refuses a type selector, which is the library markup rather than its surface', () => {
		expect(offendingSelector('button')).toMatch(/type selector/)
	})

	it('ignores an at-rule and a keyframe step', () => {
		expect(offendingSelector('@media (min-width: 40rem)')).toBeUndefined()
		expect(offendingSelector('50%')).toBeUndefined()
		expect(offendingSelector('  ')).toBeUndefined()
	})
})

describe('SPC-16 · the page and the state are compared, not diffed by key order', () => {
	it('reads two objects written in a different order as the same board', () => {
		expect(
			canonical({
				project: 'acme',
				tasks: [],
			}),
		).toBe(
			canonical({
				project: 'acme',
				tasks: [],
			}),
		)
	})

	it('still sees a task the other side does not have', () => {
		expect(
			canonical({
				tasks: [],
			}),
		).not.toBe(
			canonical({
				tasks: [
					{
						id: 'T-1',
					},
				],
			}),
		)
	})

	it('survives the values a hand-edited board grows', () => {
		expect(
			canonical({
				count: 2,
				done: true,
				report: null,
			}),
		).toBe('{"count":2,"done":true,"report":null}')
	})
})

describe('SPC-17 · the template half is not the project half', () => {
	const section = [
		'# Definition',
		'',
		'## Shape',
		'',
		'| AC-9 | the format, shown |',
		'',
		'## acme',
		'',
		'| AC-1 | a paid order is cancelled |',
		'',
		'## Never do',
		'',
		'- guess',
	].join('\n')

	it("reads the project's ids and not the template's examples", () => {
		const half = projectHalf(section, 'acme')

		expect(half).toContain('AC-1')
		expect(half).not.toContain('AC-9')
	})

	it('contributes nothing from a file that is all template', () => {
		expect(
			projectHalf(
				'# Overview\n\n## Mental model\n\nAC-2 appears here.',
				'acme',
			),
		).toBe('')
	})

	it('ignores template prose that lives under its own heading', () => {
		const source = [
			'## Shape',
			'',
			'## What a design obliges',
			'',
			'UX-DR-4 is the kind that only exists because someone wrote it down.',
			'',
			'## acme',
			'',
			'| UX-DR-1 | the action sits in the row |',
		].join('\n')

		expect(projectHalf(source, 'acme')).not.toContain('UX-DR-4')
		expect(projectHalf(source, 'acme')).toContain('UX-DR-1')
	})
})
