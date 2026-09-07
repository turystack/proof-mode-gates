import type { Check, CheckContext, CheckResult } from '@/types.js'

import { aclCoverage } from '@/checks/acl-coverage.js'
import { BACKEND_EVENT_CHECKS } from '@/checks/backend-events.js'
import { BACKEND_STRUCTURE_CHECKS } from '@/checks/backend-structure.js'
import { barrelShape } from '@/checks/barrel-shape.js'
import { componentFiles } from '@/checks/component-files.js'
import { CONTRACT_CHECKS } from '@/checks/contracts.js'
import { DELIVERY_CHECKS } from '@/checks/delivery.js'
import { domainAnatomy } from '@/checks/domain-anatomy.js'
import { folderShape } from '@/checks/folder-shape.js'
import { FRONTEND_STRUCTURE_CHECKS } from '@/checks/frontend-structure.js'
import { generatedUntouched } from '@/checks/generated-untouched.js'
import { HARNESS_CHECKS } from '@/checks/harness.js'
import { OBSERVABILITY_CHECKS } from '@/checks/observability.js'
import { oneCatalogue } from '@/checks/one-catalogue.js'
import { PRIMITIVE_CHECKS } from '@/checks/primitives.js'
import { PROJECT_SKILL_CHECKS } from '@/checks/project-skills.js'
import { RESILIENCE_CHECKS } from '@/checks/resilience.js'
import { routeOrder } from '@/checks/route-order.js'
import { routeShape } from '@/checks/route-shape.js'
import { SCOPED_CHECKS } from '@/checks/scoped.js'
import { SECURITY_CHECKS } from '@/checks/security.js'
import { slotsNamed } from '@/checks/slots.js'
import { testBindings } from '@/checks/test-bindings.js'
import { TESTING_CHECKS } from '@/checks/testing.js'
import { unfilled } from '@/checks/unfilled.js'

/** Every `gate:` binding that has a real implementation. */
export const CHECKS: Check[] = [
	aclCoverage,
	barrelShape,
	componentFiles,
	domainAnatomy,
	folderShape,
	generatedUntouched,
	oneCatalogue,
	routeOrder,
	routeShape,
	slotsNamed,
	testBindings,
	unfilled,
	...BACKEND_EVENT_CHECKS,
	...BACKEND_STRUCTURE_CHECKS,
	...CONTRACT_CHECKS,
	...DELIVERY_CHECKS,
	...FRONTEND_STRUCTURE_CHECKS,
	...HARNESS_CHECKS,
	...OBSERVABILITY_CHECKS,
	...PRIMITIVE_CHECKS,
	...PROJECT_SKILL_CHECKS,
	...RESILIENCE_CHECKS,
	...SCOPED_CHECKS,
	...SECURITY_CHECKS,
	...TESTING_CHECKS,
].sort((left, right) => left.id.localeCompare(right.id))

/**
 * Two checks answering to the same id is a silent overwrite: whichever one the
 * registry happens to reach second decides what that binding means. Assembling
 * the list from ten modules makes that easy to do by accident, so the assembly
 * refuses rather than picking one.
 */
const duplicates = CHECKS.map((check) => check.id).filter(
	(id, index, ids) => ids.indexOf(id) !== index,
)

if (duplicates.length > 0) {
	throw new Error(
		`duplicate gate id(s): ${[
			...new Set(duplicates),
		].join(', ')}`,
	)
}

/**
 * Bindings the skills declare and this runner does not implement yet.
 *
 * They are listed rather than omitted, and they report `pending` rather than
 * `pass`. The difference matters: a report that silently drops what it cannot
 * check is a report claiming coverage it does not have, which is exactly the
 * failure the `manual` class exists to avoid on the other side.
 */
export function pendingChecks(declared: string[]): CheckResult[] {
	const implemented = new Set(CHECKS.map((check) => check.id))

	return declared
		.filter((id) => !implemented.has(id))
		.sort()
		.map((id) => ({
			id,
			state: 'pending' as const,
			summary: 'declared by a skill, not implemented by this runner yet',
			violations: [],
		}))
}

export async function runChecks(
	context: CheckContext,
	only?: string[],
): Promise<CheckResult[]> {
	const selected = only
		? CHECKS.filter((check) => only.includes(check.id))
		: CHECKS

	const results: CheckResult[] = []

	for (const check of selected) {
		results.push(await check.run(context))
	}

	return results.sort((left, right) => left.id.localeCompare(right.id))
}
