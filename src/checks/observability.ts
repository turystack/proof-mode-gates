import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'

/**
 * What has to be true for an incident to be readable afterwards.
 *
 * Both laws here are about the same failure: a system that logs plenty and
 * still cannot answer "what happened to *this* request", because nothing ties
 * the lines together and the error at the edge no longer resembles its cause.
 */

/**
 * `ARC-OBS-1` — a request carries a correlation id from edge to edge.
 *
 * Without it, an incident is a pile of lines with timestamps, and the join
 * everyone does by hand at 3am is the one the system should have done.
 */
export const correlation: Check = {
	id: 'correlation',
	rules: [
		'ARC-OBS-1',
	],
	async run(context: CheckContext) {
		const entries = context.files.filter((file) =>
			/(?:main|server|app|bootstrap)\.ts$/.test(file),
		)
		const violations: Violation[] = []

		for (const file of entries) {
			const source = await context.read(file)

			if (
				/\b(?:correlationId|requestId|traceId|AsyncLocalStorage|contextMiddleware)\b/.test(
					source,
				)
			) {
				continue
			}

			violations.push({
				file,
				message:
					'no correlation id established at the edge — an incident then reads as a pile of timestamped lines nobody can join',
				rule: 'ARC-OBS-1',
			})
		}

		return conclude('correlation', violations, entries.length, 'entry point(s)')
	},
}

/**
 * `ARC-ERR-3` — errors leave through one envelope.
 *
 * Two shapes on the wire means the client has two parsers, and the second one
 * is written the day someone hits the path that produces the other shape.
 */
export const errorEnvelope: Check = {
	id: 'error-envelope',
	rules: [
		'ARC-ERR-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const controllers = context.files.filter((file) =>
			file.endsWith('.controller.ts'),
		)

		for (const file of controllers) {
			const source = await context.read(file)
			const adhoc =
				/\bres(?:ponse)?\.status\(\s*[45]\d\d\s*\)\s*\.\s*(?:json|send)\(/.exec(
					source,
				)

			if (!adhoc) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, adhoc.index),
				message:
					'an error shaped at the call site — throw the catalogue error and let the single envelope render it, or the client ends up with two parsers',
				rule: 'ARC-ERR-3',
			})
		}

		return conclude(
			'error-envelope',
			violations,
			controllers.length,
			'controller(s)',
		)
	},
}

export const OBSERVABILITY_CHECKS: Check[] = [
	correlation,
	errorEnvelope,
]
