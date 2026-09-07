import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `ARC-LAY-5` / `CMP-2` / `STR-3` — a barrel publishes a surface; it does not
 * implement one.
 *
 * A barrel that declares anything is a file consumers import for one symbol and
 * receive a module's worth of evaluation from. Worse, it becomes a place to put
 * "just this one helper", and the boundary stops meaning anything.
 */

/**
 * `export type * from` is a re-export and was missing here, so the one form
 * that publishes types without publishing values read as a declaration. A bare
 * `import './index.css'` is allowed for the same reason: a component library's
 * root barrel is where its stylesheet enters, which is publishing a surface
 * rather than implementing one.
 */
const ALLOWED =
	/^\s*(?:\/\/|\/\*|\*|$|export\s+(?:type\s*\*|\*|type\s*\{|\{)|\}\s*from|import\s+['"][^'"]+\.(?:css|scss)['"]|['"`])/

export function offendingLine(line: string): boolean {
	if (ALLOWED.test(line)) {
		return false
	}

	// A multi-line `export { … } from '…'` has bare member lines between braces.
	return !/^\s*[\w$]+\s*,?\s*$/.test(line)
}

export const barrelShape: Check = {
	id: 'barrel-shape',
	rules: [
		'ARC-LAY-5',
		'CMP-2',
		'STR-3',
	],
	async run(context: CheckContext) {
		const violations: Violation[] = []
		const candidates = context.files.filter(
			(file) =>
				(file.endsWith('/index.ts') || file.endsWith('/index.tsx')) &&
				// Under a file-based router, `routes/index.tsx` is the `/` route:
				// the name is the URL, not a claim about the file's shape. Read as
				// a barrel it produced 182 findings on a freshly generated project,
				// every one of them a line of an ordinary screen.
				!file.includes('/routes/'),
		)
		const barrels: string[] = []

		for (const file of candidates) {
			const source = await context.read(file)

			// A CLI entry point is also called `index.ts`, and it is not a barrel:
			// it imports, branches and runs, so every line of it reads as a
			// violation. `cli/src/index.ts` alone produced 87 findings, which is
			// the shape of a check nobody will read twice. The shebang is the
			// file saying what it is.
			if (source.startsWith('#!')) {
				continue
			}

			barrels.push(file)

			source.split('\n').forEach((line, index) => {
				if (!offendingLine(line)) {
					return
				}

				violations.push({
					file,
					line: index + 1,
					message: `a barrel only re-exports — '${line.trim().slice(0, 60)}' declares something`,
					rule: 'ARC-LAY-5',
				})
			})
		}

		return conclude('barrel-shape', violations, barrels.length, 'barrel(s)')
	},
}
