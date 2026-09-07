import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `STY-L4` — every element a primitive paints wears a name a theme can reach.
 *
 * The theming surface is class selectors: `.card-root`, `.select-trigger`,
 * `.input-field`. Where the class is missing the element is unreachable — it
 * renders, it looks right, and no theme can touch it. Nothing fails, which is
 * why it drifts: an audit of `@turystack/react-web` found 257 such elements,
 * including a `Table` whose ten slots carried no name at all.
 *
 * The name is derived, never invented: a `tv()` slot keyed `cellContent` on
 * `table` must carry `table-cell-content`, and a `base` must carry some
 * `table-…`. Deriving it means the check can say what is missing rather than
 * only that something is, and two people naming the same slot land on the same
 * class.
 */

const COMPONENT = /^src\/(?:components|ui)\/([^/]+)\//

/** `cellContent` → `cell-content`. */
function kebab(key: string): string {
	return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** The body of the object literal whose `{` is at `open`. */
function block(source: string, open: number): string {
	let depth = 0

	for (let index = open; index < source.length; index++) {
		if (source[index] === '{') {
			depth++
		} else if (source[index] === '}') {
			depth--

			if (depth === 0) {
				return source.slice(open + 1, index)
			}
		}
	}

	return ''
}

function skipString(body: string, index: number): number {
	const quote = body[index]
	let cursor = index + 1

	while (cursor < body.length && body[cursor] !== quote) {
		if (body[cursor] === '\\') {
			cursor++
		}
		cursor++
	}

	return cursor + 1
}

function skipComment(body: string, index: number): number {
	if (body[index + 1] === '/') {
		const end = body.indexOf('\n', index)
		return end === -1 ? body.length : end + 1
	}

	const end = body.indexOf('*/', index + 2)
	return end === -1 ? body.length : end + 2
}

/**
 * The top-level entries of an object literal body.
 *
 * Scoping matters more than it looks. `base` is a `tv()` root, but it is also
 * an ordinary variant name — `size: { base: 'text-base' }` is a size called
 * "base" — and a file-wide regex cannot tell the two apart.
 */
export function entries(body: string): {
	key: string
	value: string
}[] {
	const out: {
		key: string
		value: string
	}[] = []
	let index = 0
	let depth = 0

	while (index < body.length) {
		const char = body[index]

		if (char === '{' || char === '[' || char === '(') {
			depth++
			index++
			continue
		}

		if (char === '}' || char === ']' || char === ')') {
			depth--
			index++
			continue
		}

		if (char === "'" || char === '"' || char === '`') {
			index = skipString(body, index)
			continue
		}

		if (char === '/' && (body[index + 1] === '/' || body[index + 1] === '*')) {
			index = skipComment(body, index)
			continue
		}

		if (depth !== 0) {
			index++
			continue
		}

		const key = /^(['"`]?)(\w+)\1\s*:/.exec(body.slice(index))

		if (!key) {
			index++
			continue
		}

		let cursor = index + key[0].length

		while (cursor < body.length && /\s/.test(body[cursor])) {
			cursor++
		}

		const from = cursor
		let inner = 0

		while (cursor < body.length) {
			const current = body[cursor]

			if (current === '{' || current === '[' || current === '(') {
				inner++
			} else if (current === '}' || current === ']' || current === ')') {
				if (inner === 0) {
					break
				}
				inner--
			} else if (current === ',' && inner === 0) {
				break
			} else if (current === "'" || current === '"' || current === '`') {
				cursor = skipString(body, cursor) - 1
			} else if (
				current === '/' &&
				(body[cursor + 1] === '/' || body[cursor + 1] === '*')
			) {
				cursor = skipComment(body, cursor) - 1
			}

			cursor++
		}

		out.push({
			key: key[2],
			value: body.slice(from, cursor),
		})
		index = cursor
	}

	return out
}

/** Every class token a slot value contributes, string or array of strings. */
function classTokens(value: string): string[] {
	return [
		...value.matchAll(/'([^']*)'|"([^"]*)"/g),
	]
		.map((match) => match[1] ?? match[2])
		.join(' ')
		.split(/\s+/)
		.filter(Boolean)
}

export const slotsNamed: Check = {
	id: 'slots-named',
	rules: [
		'STY-L4',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const files = context.files.filter(
			(file) => /\.tsx?$/.test(file) && !/\.test\./.test(file),
		)

		let checked = 0

		for (const file of files) {
			const owner = COMPONENT.exec(file)?.[1]
			const source = await context.read(file).catch(() => '')

			if (!owner) {
				// An element painted from outside a component folder has no directory
				// to name it. `FilePicker` lived in `src/internal` for exactly as long
				// as nobody looked, publishing a class named after another component.
				if (
					/\.tsx$/.test(file) &&
					!file.startsWith('src/shadcn/') &&
					/className=/.test(source)
				) {
					violations.push({
						file,
						message:
							'paints from outside a component folder — no directory owns it, so no slot can be named for it',
						rule: 'STY-L4',
					})
				}

				continue
			}

			const semantic = new RegExp(`^${owner}(-[a-z0-9-]+)?$`)
			const expected = (key: string) =>
				key === 'base' || key === 'root'
					? [
							owner,
							`${owner}-root`,
						]
					: [
							`${owner}-${kebab(key)}`,
						]

			for (const call of source.matchAll(/\btv\(\s*\{/g)) {
				const config = block(source, (call.index ?? 0) + call[0].length - 1)

				for (const entry of entries(config)) {
					if (entry.key === 'base') {
						checked++

						if (
							!classTokens(entry.value).some((token) => semantic.test(token))
						) {
							violations.push({
								file,
								message: `a tv() base carries no \`${owner}-…\` class — the element renders and no theme can reach it`,
								rule: 'STY-L4',
							})
						}
					}

					if (entry.key === 'slots') {
						for (const slot of entries(entry.value.replace(/^\{|\}$/g, ''))) {
							checked++
							const want = expected(slot.key)
							const tokens = classTokens(slot.value)

							if (!want.some((token) => tokens.includes(token))) {
								violations.push({
									file,
									message: `slot \`${slot.key}\` does not carry \`${want[0]}\``,
									rule: 'STY-L4',
								})
							}
						}
					}
				}
			}

			if (file.endsWith('.tsx')) {
				for (const match of source.matchAll(/className="([^"]+)"/g)) {
					checked++
					const tokens = match[1].split(/\s+/)

					if (
						!tokens.some(
							(token) => token === owner || token.startsWith(`${owner}-`),
						)
					) {
						violations.push({
							file,
							message: `className="${match[1]}" carries no \`${owner}-…\` slot`,
							rule: 'STY-L4',
						})
					}
				}
			}
		}

		return conclude('slots-named', violations, checked, 'painted element(s)')
	},
}
