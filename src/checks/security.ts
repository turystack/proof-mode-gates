import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude, lineOf } from '@/checks/conclude.js'
import { aside, scannable } from '@/checks/scope.js'

// turystack-proof:pattern-data — the secret and credential shapes below are the patterns being looked for, not uses of them.

/**
 * The security laws a tree can answer.
 *
 * None of these is a vulnerability scanner. Each is the *declaration* the law
 * requires — a strict schema, a verified signature, a credential that is not in
 * the repository — and the declaration is what a gate can check honestly.
 */

/**
 * `ARC-SEC-4` — input schemas reject what they did not declare.
 *
 * A permissive object accepts extra fields and passes them on. Somewhere
 * downstream, one of them is spread into an update.
 */
export const schemaStrict: Check = {
	id: 'schema-strict',
	rules: [
		'ARC-SEC-4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const schemas = context.files.filter((file) => /\.schema\.ts$/.test(file))
		let objects = 0

		for (const file of schemas) {
			const source = await context.read(file)

			for (const match of source.matchAll(
				/export const (\w*(?:Request|Input)\w*)\s*=\s*z\.object\(/g,
			)) {
				objects += 1
				const tail = source.slice(match.index)
				// `.strict()` is chained *after* the closing `})`, so the slice has to
				// reach past it. Stopping at the brace is how this check would have
				// failed every strict schema in the codebase and called it a finding.
				const block = tail.slice(0, tail.indexOf('\n})') + 24)

				if (/\.strict\(\)/.test(block)) {
					continue
				}

				violations.push({
					file,
					line: lineOf(source, match.index ?? 0),
					message: `${match[1]} is not .strict() — an undeclared field is accepted and carried on, and somewhere downstream it is spread into an update`,
					rule: 'ARC-SEC-4',
				})
			}
		}

		return conclude('schema-strict', violations, objects, 'input schema(s)')
	},
}

/**
 * `ARC-SEC-7` — a webhook verifies the signature before it believes anything.
 *
 * A webhook endpoint is a public POST that mutates. Without the signature check
 * it is an unauthenticated write with a friendly name.
 */
export const webhookSignature: Check = {
	id: 'webhook-signature',
	rules: [
		'ARC-SEC-7',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter(
			(file) => /webhook/i.test(file) && file.endsWith('.ts'),
		)

		for (const file of files) {
			const source = await context.read(file)

			if (
				/\b(?:verifySignature|constructEvent|timingSafeEqual|verifyWebhook)\b/.test(
					source,
				)
			) {
				continue
			}

			violations.push({
				file,
				message:
					'no signature verification — a webhook is a public POST that mutates, so without it this is an unauthenticated write with a friendly name',
				rule: 'ARC-SEC-7',
			})
		}

		return conclude(
			'webhook-signature',
			violations,
			files.length,
			'webhook file(s)',
		)
	},
}

/**
 * `ARC-SEC-8` — a credential is never committed.
 *
 * The check looks for the shapes that are unambiguous. It is deliberately not
 * an entropy heuristic: a gate that cries wolf gets an ignore comment, and the
 * ignore comment is what the next real leak hides behind.
 */
const SECRET_SHAPES: Array<
	[
		RegExp,
		string,
	]
> = [
	[
		/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/,
		'a provider secret key',
	],
	[
		/\bAKIA[0-9A-Z]{16}\b/,
		'an AWS access key id',
	],
	[
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
		'a private key',
	],
	[
		/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
		'a signed token',
	],
	[
		/\bghp_[A-Za-z0-9]{30,}/,
		'a GitHub token',
	],
]

export function secretIn(line: string): string | undefined {
	for (const [shape, what] of SECRET_SHAPES) {
		if (shape.test(line)) {
			return what
		}
	}

	return undefined
}

export const secretScan: Check = {
	id: 'secret-scan',
	rules: [
		'ARC-SEC-8',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files } = await scannable(context, () => true)

		for (const file of files) {
			const source = await context.read(file).catch(() => '')

			for (const [index, line] of source.split('\n').entries()) {
				const what = secretIn(line)

				if (!what) {
					continue
				}

				violations.push({
					file,
					line: index + 1,
					message: `${what} is committed here — rotate it, then move it to the environment; a repository is not a secret store`,
					rule: 'ARC-SEC-8',
				})
			}
		}

		return conclude(
			'secret-scan',
			violations,
			files.length,
			'file(s)',
			aside(excluded),
		)
	},
}

/**
 * `UPL-5` — the browser never holds a storage credential.
 *
 * A signed URL expires and is scoped to one object; a key shipped to the client
 * is neither, and it is readable by anyone who opens the bundle.
 */
export const noStorageCredential: Check = {
	id: 'no-storage-credential',
	rules: [
		'UPL-5',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const { excluded, files } = await scannable(context, (file) =>
			/\.(?:ts|tsx)$/.test(file),
		)
		const CLIENT_CREDENTIAL =
			/\b(?:accessKeyId|secretAccessKey|storageAccountKey|VITE_[A-Z_]*(?:SECRET|KEY|TOKEN))\b/

		for (const file of files) {
			const source = await context.read(file).catch(() => '')
			const match = CLIENT_CREDENTIAL.exec(source)

			if (!match) {
				continue
			}

			violations.push({
				file,
				line: lineOf(source, match.index),
				message: `${match[0]} reaches the browser — a signed URL expires and is scoped to one object; a key in the bundle is neither`,
				rule: 'UPL-5',
			})
		}

		return conclude(
			'no-storage-credential',
			violations,
			files.length,
			'source file(s)',
			aside(excluded),
		)
	},
}

export const SECURITY_CHECKS: Check[] = [
	noStorageCredential,
	schemaStrict,
	secretScan,
	webhookSignature,
]
