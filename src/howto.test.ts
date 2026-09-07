import { describe, expect, it } from 'vitest'

import { stripHowto } from '@/howto.js'

describe('the start-here comments a materialized skill ships with', () => {
	const skill = [
		'<!-- turystack:howto',
		'     HOW TO START acme-spec',
		'     fill the glossary first',
		'     -->',
		'',
		'# acme-spec',
	].join('\n')

	it('removes the block and leaves the section', () => {
		const result = stripHowto(skill)

		expect(result.blocks).toBe(1)
		expect(result.stripped).toBe('\n# acme-spec')
	})

	it('leaves the unfilled markers alone — those are decisions, not instructions', () => {
		const source = `${skill}\n\n<!-- turystack:unfilled -->\n`
		const result = stripHowto(source)

		expect(result.stripped).toContain('turystack:unfilled')
	})

	it('reports nothing to do on a skill that has been started', () => {
		const result = stripHowto('# acme-spec\n')

		expect(result.blocks).toBe(0)
		expect(result.stripped).toBe('# acme-spec\n')
	})

	it('removes every block, including one indented inside a page', () => {
		const page = [
			'<head>',
			'  <!-- turystack:howto',
			'       how to start this board',
			'       -->',
			'</head>',
			'<!-- turystack:howto second -->',
		].join('\n')
		const result = stripHowto(page)

		expect(result.blocks).toBe(2)
		expect(result.stripped).toBe('<head>\n</head>\n')
	})
})

/**
 * A comment ends at the first `-->`, in this stripper and in every browser.
 *
 * The first version of the shipped blocks quoted the unfilled marker in full,
 * which closed the comment two thirds of the way through and left the rest of
 * the instructions rendering as text on the page.
 */
describe('a how-to block ends at the first comment terminator', () => {
	it('stops there, which is why a block may not quote one', () => {
		const source =
			'<!-- turystack:howto\n  see <!-- turystack:unfilled -->\n  more\n  -->\n# title'
		const result = stripHowto(source)

		expect(result.blocks).toBe(1)
		expect(result.stripped).toContain('more')
	})
})
