import { createHash } from 'node:crypto'

import type { CheckContext } from '@/types.js'

import { type Declaration, declaredIds } from '@/checks/harness.js'

/**
 * A short, stable digest of the text a decision was written in.
 *
 * Twelve hex characters, not thirty-two: this is read by people, printed beside
 * an id in a terminal, and compared for equality — never for secrecy.
 */
export function fingerprint(...parts: string[]): string {
	return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12)
}

/**
 * What an id's decision says right now.
 *
 * The unit is the line, because that is the unit a spec writes a decision in —
 * a table row, a bullet — and because a change small enough not to move a line
 * is a change small enough not to move the meaning.
 */
export function hashOf(declaration: Declaration): string {
	return fingerprint(...declaration.lines)
}

/**
 * The digest of a whole claim: several ids proved by one report.
 *
 * Order comes from the caller's list rather than the map, so the same task
 * hashes the same way on every machine.
 */
export function hashOfAll(hashes: string[]): string {
	return fingerprint(...hashes)
}

/**
 * Every declared id, digested.
 *
 * This is the whole of `T1`: the cheap answer to "has this decision moved since
 * somebody proved it". It reads the disk and nothing else — no LLM, no network,
 * no opinion.
 */
export async function specHashes(
	context: CheckContext,
): Promise<Map<string, string>> {
	const declared = await declaredIds(context)

	return new Map(
		[
			...declared.entries(),
		].map(([id, declaration]) => [
			id,
			hashOf(declaration),
		]),
	)
}

/**
 * The digests a report should carry for the ids its task claims.
 *
 * An id the task claims and the spec does not declare is left out rather than
 * hashed as empty: it is a finding `board-covers-spec` already makes, and
 * inventing a digest for it here would let a later run call it unchanged.
 */
export async function specHashesFor(
	context: CheckContext,
	ids: string[],
): Promise<Record<string, string>> {
	const hashes = await specHashes(context)
	const claimed: Record<string, string> = {}

	for (const id of ids) {
		const hash = hashes.get(id)

		if (hash !== undefined) {
			claimed[id] = hash
		}
	}

	return claimed
}
