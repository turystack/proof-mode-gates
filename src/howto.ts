import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The instructions a freshly materialized project skill arrives with.
 *
 * A skill that ships empty has to say how to start, and the only place those
 * words can live without being mistaken for content is a comment. They stop
 * being true the moment someone starts — an empty-board page explaining how to
 * derive a board reads as wrong once the board has fourteen tasks — so removing
 * them is a command rather than a chore nobody remembers.
 *
 * The `turystack:unfilled` markers are deliberately left alone. Those are
 * decisions nobody has made yet, and they go when someone makes them.
 */

const BLOCK = /[^\S\n]*<!--\s*turystack:howto[\s\S]*?-->\n?/g
const READABLE = /\.(?:md|html|json|css)$/

export type HowtoFile = {
	blocks: number
	file: string
}

/** How many how-to blocks a source carries, and the source without them. */
export function stripHowto(source: string): {
	blocks: number
	stripped: string
} {
	const blocks = [
		...source.matchAll(BLOCK),
	].length

	return {
		blocks,
		stripped: blocks === 0 ? source : source.replace(BLOCK, ''),
	}
}

async function filesUnder(directory: string): Promise<string[]> {
	const entries = await readdir(directory, {
		withFileTypes: true,
	}).catch(() => [])
	const files: string[] = []

	for (const entry of entries) {
		const path = join(directory, entry.name)

		if (entry.isDirectory()) {
			files.push(...(await filesUnder(path)))
			continue
		}

		if (READABLE.test(entry.name)) {
			files.push(path)
		}
	}

	return files.sort()
}

/**
 * Removes every how-to block under a directory.
 *
 * `strip: false` reports what would change and writes nothing, because the
 * command's whole audience is someone running it on a skill they have just
 * started filling.
 */
export async function howto(
	directory: string,
	strip: boolean,
): Promise<HowtoFile[]> {
	const found: HowtoFile[] = []

	for (const file of await filesUnder(directory)) {
		const source = await readFile(file, 'utf8').catch(() => '')
		const result = stripHowto(source)

		if (result.blocks === 0) {
			continue
		}

		found.push({
			blocks: result.blocks,
			file,
		})

		if (strip) {
			await writeFile(file, result.stripped, 'utf8')
		}
	}

	return found
}
