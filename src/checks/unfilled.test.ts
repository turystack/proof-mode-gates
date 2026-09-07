import { describe, expect, it } from 'vitest'

import { isProjectSkillSection, stripFences } from '@/checks/unfilled.js'

describe('the unfilled marker', () => {
	it('is found in a project skill, not in a law skill', () => {
		expect(
			isProjectSkillSection('.claude/skills/acme-spec/01-definition.md'),
		).toBe(true)
		expect(isProjectSkillSection('.claude/skills/acme-uiux/05-assets.md')).toBe(
			true,
		)
		expect(
			isProjectSkillSection(
				'.claude/skills/turystack-backend-pattern/01-project-structure.md',
			),
		).toBe(false)
	})

	it('ignores a marker that is being documented rather than used', () => {
		const source = [
			'# A skill',
			'```markdown',
			'<!-- turystack:unfilled -->',
			'```',
			'prose',
		].join('\n')

		expect(stripFences(source)).not.toContain('turystack:unfilled')
	})

	it('keeps line numbers true so a violation points at the right line', () => {
		const source = [
			'one',
			'```',
			'a',
			'b',
			'```',
			'<!-- turystack:unfilled -->',
		].join('\n')
		const stripped = stripFences(source)

		expect(stripped.split('\n').length).toBe(source.split('\n').length)
		expect(stripped.slice(0, stripped.indexOf('<!--')).split('\n').length).toBe(
			6,
		)
	})
})
