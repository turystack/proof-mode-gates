import { describe, expect, it } from 'vitest'

import { inspectRoutePath } from '@/checks/route-shape.js'

/**
 * The fixture pair matters more than the rule here.
 *
 * A detector written from one example catches that example. The nominalized
 * case (`cancellation-impact`) is in the negative fixtures on purpose: it is
 * the one a verb blacklist lets through, and it is the mistake that produced
 * this rule in the first place.
 */
describe('CTL-7 · route shape', () => {
	describe('accepts', () => {
		const legal: [
			string,
			string,
		][] = [
			[
				'a custom method on POST',
				':orderId::cancel',
			],
			[
				'a collection',
				'orders',
			],
			[
				'a nested collection',
				':orderId/shipments',
			],
			[
				'a surface prefix',
				'api/v1/app/orders',
			],
			[
				'a param on its own',
				':orderId',
			],
		]

		for (const [description, path] of legal) {
			it(description, () => {
				expect(inspectRoutePath(path, 'POST')).toBeUndefined()
			})
		}
	})

	describe('refuses', () => {
		it('a verb as a segment', () => {
			expect(inspectRoutePath(':invoiceId/pay', 'POST')).toContain('singular')
		})

		it('a nominalized action, which a verb blacklist would miss', () => {
			expect(inspectRoutePath(':orderId/cancellation-impact', 'GET')).toContain(
				'hyphenated',
			)
		})

		it('a custom method outside POST', () => {
			expect(inspectRoutePath(':invoiceId::pay', 'GET')).toContain(
				'must be POST',
			)
		})
	})

	it('states its limit: a plural nominalization still passes', () => {
		// Documented in turystack-backend-pattern: this half of CTL-7 stays
		// `manual`, and the report shows it as signed rather than checked.
		expect(inspectRoutePath(':orderId/cancellations', 'GET')).toBeUndefined()
	})
})
