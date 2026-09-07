import type { CheckContext } from '@/types.js'

/**
 * Which files a content-scanning check may read as code.
 *
 * Some files contain the text of a violation without being one. A fixture holds
 * a deliberate `sk_live_…` so the secret scanner can be proved to catch it; a
 * detector holds `/biome-ignore/` because that is the pattern it looks for.
 * Read as code, both are findings, and both are guaranteed — they fire on every
 * run, forever, and the only thing they teach is that the gate is noise.
 *
 * That is the failure this repository keeps naming: a gate that cries wolf gets
 * bypassed, and `DLV-9` then has to catch the bypass. So the exclusion is
 * explicit, narrow, and **counted**:
 *
 *   - a path under `fixtures/` or `__fixtures__/` — the config packages' proof
 *     pairs, whose entire purpose is to be dirty
 *   - a file whose first lines declare the marker below
 *
 * This is not `biome-ignore` with a new name. Three things keep it from
 * becoming one: it is per file and never per line, so it cannot be sprinkled
 * over a violation; it applies only to checks that read file *content*, never
 * to structural ones; and every check that honours it reports the count, so an
 * excluded file is visible in the summary rather than absent from it.
 */

export const PATTERN_DATA = 'turystack-proof:pattern-data'

const FIXTURE_PATH = /(?:^|\/)(?:fixtures|__fixtures__)\//

/** Only the head of the file: the marker is a declaration, not a comment. */
const HEAD = 2000

export function isFixturePath(file: string): boolean {
	return FIXTURE_PATH.test(file)
}

export type Scanned = {
	/** Files a content check may read as code. */
	files: string[]
	/** How many were set aside, for the summary. */
	excluded: number
}

export async function scannable(
	context: CheckContext,
	pick: (file: string) => boolean,
): Promise<Scanned> {
	const candidates = context.files.filter(pick)
	const files: string[] = []
	let excluded = 0

	for (const file of candidates) {
		if (isFixturePath(file)) {
			excluded += 1
			continue
		}

		const head = (await context.read(file)).slice(0, HEAD)

		if (head.includes(PATTERN_DATA)) {
			excluded += 1
			continue
		}

		files.push(file)
	}

	return {
		excluded,
		files,
	}
}

/** The suffix a summary carries when something was set aside. */
export function aside(excluded: number): string {
	return excluded > 0 ? ` · ${excluded} holding pattern data` : ''
}
