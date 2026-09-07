import type { Check, CheckContext, Violation } from '@/types.js'

import { conclude } from '@/checks/conclude.js'

/**
 * `CMP-1`, `CMP-3`, `CMP-5` — one component is one folder with its
 * implementation, its contract, its test and its barrel; stories as well, in
 * the shared library. Anything else in the folder is named after it.
 *
 * The set is what makes a primitive reviewable: a missing `.types.ts` means the
 * contract is inline and cannot be derived from (`USO-2`), and a missing
 * `index.ts` means consumers reach into the folder (`ARC-LAY-5`).
 *
 * `CMP-3` is the other half of the same idea, and it was enforced for a long
 * time by a script inside `react-web` that this runner had never heard of — so
 * the one package with the check was the one package whose report did not
 * mention it, and `react-mobile` was to inherit the contract and none of the
 * enforcement. An auxiliary file that does not carry the component's name is
 * how a folder starts holding two components.
 */

const COMPONENT_DIRECTORY = /^(src\/(?:components|ui)\/[^/]+)\//

export function componentFolders(files: string[]): Map<string, Set<string>> {
	const folders = new Map<string, Set<string>>()

	for (const file of files) {
		const match = COMPONENT_DIRECTORY.exec(file)

		if (!match) {
			continue
		}

		const folder = match[1]
		const name = file.slice(folder.length + 1)

		if (name.includes('/')) {
			continue
		}

		const entries = folders.get(folder) ?? new Set<string>()
		entries.add(name)
		folders.set(folder, entries)
	}

	return folders
}

export const componentFiles: Check = {
	id: 'component-files',
	rules: [
		'CMP-1',
		'CMP-3',
		'CMP-5',
	],
	run(context: CheckContext) {
		const violations: Violation[] = []
		const folders = componentFolders(context.files)
		const library = context.files.some((file) =>
			file.startsWith('src/components/'),
		)

		for (const [folder, entries] of folders) {
			const component = folder.slice(folder.lastIndexOf('/') + 1)
			const required = [
				`${component}.tsx`,
				`${component}.types.ts`,
				`${component}.test.tsx`,
				'index.ts',
			]

			if (library && folder.startsWith('src/components/')) {
				required.push(`${component}.stories.tsx`)
			}

			// CMP-3 — every auxiliary *module* in the folder wears the component's
			// name. Three things are not auxiliary modules and are exempt: the
			// barrel, which is the folder's own; a `use-…` hook, which the library
			// names after the hook a consumer imports, not after the folder; and
			// anything that is not TypeScript, because an asset has no contract to
			// keep in sync.
			for (const entry of entries) {
				if (
					entry === 'index.ts' ||
					entry.startsWith(`${component}.`) ||
					entry.startsWith('use-') ||
					!/\.tsx?$/.test(entry)
				) {
					continue
				}

				violations.push({
					file: `${folder}/${entry}`,
					message: `does not carry the component's name — an auxiliary file is \`${component}.<what>.ts\`, and a folder whose files answer to two names is holding two components`,
					rule: 'CMP-3',
				})
			}

			for (const file of required) {
				if (!entries.has(file)) {
					violations.push({
						file: `${folder}/${file}`,
						message: `missing from the component's file set — a component is its implementation, contract, test and barrel${
							file.endsWith('.stories.tsx')
								? ', plus stories in the shared library'
								: ''
						}`,
						rule: 'CMP-1',
					})
				}
			}
		}

		return conclude(
			'component-files',
			violations,
			folders.size,
			'component folder(s)',
		)
	},
}
