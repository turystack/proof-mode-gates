import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'

/**
 * Resilience is a property of the boundary, not of the call site.
 *
 * Every law here has the same shape: the thing that can hang, fail or storm is
 * the remote side, so the declaration that bounds it belongs where the remote
 * side is reached — once, in the adapter — and nowhere else.
 */

const isPort = (file: string) => /\.(?:adapter|client|gateway)\.ts$/.test(file)

/**
 * `ARC-RSL-1` — every outbound call declares a timeout.
 *
 * The default is "wait forever", and forever is exactly how long a request will
 * wait on the day the provider stops answering rather than refusing.
 */
export const timeoutDeclared: Check = {
	id: 'timeout-declared',
	rules: [
		'ARC-RSL-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const ports = context.files.filter(isPort)

		for (const file of ports) {
			const source = await context.read(file)
			const calls = /\b(?:fetch|axios|request|\.get\(|\.post\()/.test(source)

			if (
				!calls ||
				/\b(?:timeout|signal|AbortSignal|deadline)\b/.test(source)
			) {
				continue
			}

			violations.push({
				file,
				message:
					'an outbound call with no timeout — the default is to wait forever, which is what happens the day the provider stops answering instead of refusing',
				rule: 'ARC-RSL-1',
			})
		}

		return conclude('timeout-declared', violations, ports.length, 'port(s)')
	},
}

/**
 * `RSL-1` / `RSL-3` — retry, timeout and breaker are declared at the port.
 *
 * Spread across callers they compose by accident: three callers each retrying
 * three times is twenty-seven requests to a provider that is already failing.
 */
export const resilienceAtPort: Check = {
	id: 'resilience-at-port',
	rules: [
		'RSL-1',
		'RSL-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const callers = context.files.filter((file) =>
			/\.(?:use-case|controller|service)\.ts$/.test(file),
		)

		for (const file of callers) {
			const source = await context.read(file)
			const match =
				/\b(?:retry|withRetry|pRetry|backoff|circuitBreaker)\s*\(/.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message:
					'retry/breaker declared outside the adapter — spread across callers these compose by accident, and three callers retrying three times is twenty-seven requests at a provider already failing',
				rule: 'RSL-1',
			})
		}

		return conclude(
			'resilience-at-port',
			violations,
			callers.length,
			'caller(s)',
		)
	},
}

/**
 * `RSL-2` — retries do not nest.
 *
 * Two layers of three attempts is nine, and the number nobody wrote down is the
 * one the provider experiences.
 */
export function retryDepth(source: string): number {
	const opens = [
		...source.matchAll(/\b(?:retry|withRetry|pRetry)\s*\(/g),
	]

	return opens.length
}

export const noNestedRetry: Check = {
	id: 'no-nested-retry',
	rules: [
		'RSL-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const ports = context.files.filter(isPort)

		for (const file of ports) {
			const source = await context.read(file)

			if (retryDepth(source) < 2) {
				continue
			}

			violations.push({
				file,
				message: `${retryDepth(source)} retry wrappers in one port — attempts multiply, and the number the provider experiences is the one nobody wrote down`,
				rule: 'RSL-2',
			})
		}

		return conclude('no-nested-retry', violations, ports.length, 'port(s)')
	},
}

export const RESILIENCE_CHECKS: Check[] = [
	noNestedRetry,
	resilienceAtPort,
	timeoutDeclared,
]
