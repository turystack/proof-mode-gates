import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { CheckContext } from '@/types.js'

import { DELIVERY_CHECKS } from '@/checks/delivery.js'

/**
 * The checks that read the report, run against the report this package ships.
 *
 * These six were written against a payload I imagined rather than the one in
 * `templates/report.html`, and their fixtures repeated the same invention — so
 * the suite confirmed the invention and stayed green. Against the real
 * template, three of them were reading keys that do not exist:
 *
 *   manual-signed     read `laws`        · the report has `law.bindings`
 *   spec-test-link    read `specs`       · the report has `backend.specs`
 *                                          and `frontend.specs`
 *   context-recorded  read `task.inputs` · the report has `context`
 *
 * Two reported `skipped` on a report full of the thing they check, and one
 * failed for a reason it invented. All three were green-about-nothing on the
 * one artifact the whole system produces.
 *
 * So the fixture is the shipped template. A payload shape and the checks that
 * read it cannot drift apart while this test exists, because there is only one
 * of them.
 */

const TEMPLATE = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../templates/report.html',
)

const PAYLOAD =
	/<script type="application\/json" id="gate-report">([\s\S]*?)<\/script>/

function shippedReport(): string {
	const match = PAYLOAD.exec(readFileSync(TEMPLATE, 'utf8'))

	if (!match) {
		throw new Error('the shipped template has no #gate-report payload')
	}

	return match[1]
}

function contextOf(payload: string): CheckContext {
	return {
		changed: [
			'gate-report.json',
		],
		cwd: '/virtual',
		files: [
			'gate-report.json',
		],
		async read() {
			return payload
		},
	}
}

describe('the delivery checks read the report this package ships', () => {
	const payload = shippedReport()

	it('is a payload the renderer can parse', () => {
		expect(() => JSON.parse(payload)).not.toThrow()
	})

	/**
	 * `skipped` is the failure this catches. A check that reads the wrong key
	 * finds nothing, concludes it had nothing to inspect, and reports a state
	 * that reads like "not applicable" — on the artifact it was written for.
	 */
	for (const check of DELIVERY_CHECKS) {
		it(`gate:${check.id} finds something to inspect`, async () => {
			const result = await check.run(contextOf(payload))

			expect(
				result.state,
				`${check.id} reported ${result.state}: ${result.summary} — it is reading a key the shipped report does not have`,
			).not.toBe('skipped')
		})
	}

	it('reads the eight manual bindings, and each one names a reviewer', async () => {
		const manualSigned = DELIVERY_CHECKS.find(
			(check) => check.id === 'manual-signed',
		)

		const result = await manualSigned?.run(contextOf(payload))

		expect(result?.summary).toContain('manual binding(s)')
		expect(result?.state, 'every manual binding in the example is signed').toBe(
			'pass',
		)
	})

	/**
	 * The example deliberately ships `image: null` on all three required
	 * captures. `DLV-12` says a missing capture fails the delivery rather than
	 * rendering an empty box, and this is the payload that proves the check
	 * enforces it.
	 */
	it('fails the example for its missing captures, on purpose', async () => {
		const requiredCaptures = DELIVERY_CHECKS.find(
			(check) => check.id === 'required-captures',
		)

		const result = await requiredCaptures?.run(contextOf(payload))

		expect(result?.state).toBe('fail')
		expect(result?.violations).toHaveLength(3)
	})
})
