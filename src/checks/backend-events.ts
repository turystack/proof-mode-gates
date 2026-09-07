import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'

/**
 * Events and the handlers that consume them.
 *
 * The laws here are all about the same thing from two sides: a message that
 * arrives twice, or out of order, or from a version of the producer nobody
 * remembers deploying, must still be reducible to a decision. Everything below
 * is a declaration that makes that possible.
 */

/** `event.name` in kebab, dotted by domain: `order.cancellation-requested`. */
const EVENT_NAME_SHAPE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/

export function eventNameIsWellFormed(name: string): boolean {
	return EVENT_NAME_SHAPE.test(name)
}

export const eventNameShape: Check = {
	id: 'event-name-shape',
	rules: [
		'EVT-1',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) => /\.event\.ts$/.test(file))
		let names = 0

		for (const file of files) {
			const source = await context.read(file)

			for (const match of source.matchAll(/name:\s*'([^']+)'/g)) {
				names += 1

				if (eventNameIsWellFormed(match[1])) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `'${match[1]}' is not <domain>.<past-tense-fact> in kebab — the name is what a subscriber filters on, so its shape is part of the contract`,
					rule: 'EVT-1',
				})
			}
		}

		return conclude('event-name-shape', violations, names, 'event name(s)')
	},
}

/**
 * `EVT-2` — an event carries an identifier a consumer can deduplicate on.
 *
 * Delivery is at-least-once in every broker worth using. Without an id the
 * consumer cannot tell a redelivery from a second real occurrence, and the
 * difference is a double charge.
 */
export const eventIdentifier: Check = {
	id: 'event-identifier',
	rules: [
		'EVT-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) => /\.event\.ts$/.test(file))

		for (const file of files) {
			const source = await context.read(file)

			if (/\b(?:eventId|messageId|idempotencyKey)\b/.test(source)) {
				continue
			}

			violations.push({
				file,
				message:
					'no eventId/messageId — delivery is at-least-once, so without an id a redelivery is indistinguishable from a second occurrence',
				rule: 'EVT-2',
			})
		}

		return conclude('event-identifier', violations, files.length, 'event(s)')
	},
}

/**
 * `BGH-2` — a background handler validates its input like any other entry point.
 *
 * A queue is not a trusted caller. The message was serialized by a producer
 * that may be a version behind, and the handler is where that stops being
 * someone else's problem.
 */
export const handlerSchema: Check = {
	id: 'handler-schema',
	rules: [
		'BGH-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) => /\.handler\.ts$/.test(file))

		for (const file of files) {
			const source = await context.read(file)

			if (/\.(?:parse|safeParse)\(/.test(source)) {
				continue
			}

			violations.push({
				file,
				message:
					'never parses its message — a queue is not a trusted caller; the producer may be a version behind',
				rule: 'BGH-2',
			})
		}

		return conclude('handler-schema', violations, files.length, 'handler(s)')
	},
}

/**
 * `IDP-2` — the idempotency key is derived from what the operation *does*.
 *
 * A key taken from the request id changes on every retry, which makes it a
 * unique id with an idempotent name. The fingerprint has to come from the
 * operation's own inputs, or the second attempt is a second write.
 */
export const idempotencyFingerprint: Check = {
	id: 'idempotency-fingerprint',
	rules: [
		'IDP-2',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter((file) =>
			/\.(?:use-case|handler|adapter)\.ts$/.test(file),
		)
		let keys = 0

		for (const file of files) {
			const source = await context.read(file)

			for (const match of source.matchAll(
				/idempotencyKey\s*[:=]\s*([^,\n)]+)/g,
			)) {
				keys += 1

				if (
					!/\b(?:randomUUID|uuid|nanoid|requestId|Date\.now)\b/.test(match[1])
				) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message:
						'the key is generated per attempt — a fresh value on every retry is a unique id wearing an idempotent name; derive it from the operation inputs',
					rule: 'IDP-2',
				})
			}
		}

		return conclude(
			'idempotency-fingerprint',
			violations,
			keys,
			'idempotency key(s)',
		)
	},
}

export const BACKEND_EVENT_CHECKS: Check[] = [
	eventIdentifier,
	eventNameShape,
	handlerSchema,
	idempotencyFingerprint,
]
