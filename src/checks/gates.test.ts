import { describe, expect, it } from 'vitest'

import { routeIsAuthorized } from '@/checks/acl-coverage.js'
import { offendingLine } from '@/checks/barrel-shape.js'
import { firstOutOfOrder } from '@/checks/route-order.js'

describe('CTL-4 · a mutating route names who may call it', () => {
	const withAcl = `@ACL('order:cancel')\n@Route({ method: 'POST', path: ':orderId::cancel' })\nasync cancel() {}`
	const bare = `@Route({ method: 'POST', path: ':orderId::cancel' })\nasync cancel() {}`

	it('accepts a route guarded by @ACL', () => {
		expect(routeIsAuthorized(withAcl, withAcl.indexOf('@Route'))).toBe(true)
	})

	it('accepts a route that declares itself public', () => {
		const source = `@Public()\n${bare}`
		expect(routeIsAuthorized(source, source.indexOf('@Route'))).toBe(true)
	})

	it('refuses a mutating route with nothing above it', () => {
		expect(routeIsAuthorized(bare, bare.indexOf('@Route'))).toBe(false)
	})

	it("does not borrow the neighbour's @ACL", () => {
		// The regression that a fixed window let through: an unguarded route
		// sitting next to a guarded one read as covered.
		const source = [
			"@ACL('order:read')",
			"@Route({ method: 'GET', path: ':orderId' })",
			'async read() {}',
			'',
			"@Route({ method: 'DELETE', path: ':orderId' })",
			'async remove() {}',
		].join('\n')

		expect(routeIsAuthorized(source, source.lastIndexOf('@Route'))).toBe(false)
	})
})

describe('ARC-LAY-5 · a barrel only re-exports', () => {
	const allowed = [
		"export * from './button.js'",
		"export { Button } from './button.js'",
		"export type { ButtonProps } from './button.types.js'",
		'// a comment',
		'',
		'\tButton,',
		"} from './button.js'",
	]

	for (const line of allowed) {
		it(`allows ${JSON.stringify(line)}`, () => {
			expect(offendingLine(line)).toBe(false)
		})
	}

	const refused = [
		"const helper = () => 'just this one'",
		'export const VERSION = 1',
		"import { thing } from './thing.js'",
	]

	for (const line of refused) {
		it(`refuses ${JSON.stringify(line)}`, () => {
			expect(offendingLine(line)).toBe(true)
		})
	}
})

describe('CTL-5 · endpoints in a fixed order', () => {
	it('accepts the canonical order', () => {
		expect(
			firstOutOfOrder([
				'GET',
				'GET',
				'POST',
				'PUT',
				'PATCH',
				'DELETE',
			]),
		).toBe(-1)
	})

	it('accepts gaps', () => {
		expect(
			firstOutOfOrder([
				'GET',
				'DELETE',
			]),
		).toBe(-1)
	})

	it('points at the first endpoint that broke the order', () => {
		expect(
			firstOutOfOrder([
				'GET',
				'DELETE',
				'POST',
			]),
		).toBe(2)
	})
})
