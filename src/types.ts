/** What a gate concluded. `pending` is deliberate: see {@link CheckResult}. */
export type GateState = 'pass' | 'fail' | 'warn' | 'skipped' | 'pending'

/** The five kinds of binding a law can name. */
export type GateKind = 'biome' | 'grit' | 'gate' | 'test' | 'manual'

export type Violation = {
	/** Repository-relative path. */
	file: string
	/** 1-indexed, when the check can point at a line. */
	line?: number
	message: string
	/** The law this violates, e.g. `CTL-7`. */
	rule: string
}

/**
 * A structural check's outcome.
 *
 * `pending` exists so a binding that is declared in a skill but not yet
 * implemented here reports as **not checked** rather than as passing. A gate
 * that silently passes what it cannot inspect is the failure this whole system
 * is built to avoid.
 */
export type CheckResult = {
	id: string
	state: GateState
	summary: string
	violations: Violation[]
}

export type Check = {
	/** The binding a skill's Gate column names, without the `gate:` prefix. */
	id: string
	/** Laws this check enforces, for the report's law coverage. */
	rules: string[]
	run(context: CheckContext): Promise<CheckResult> | CheckResult
}

export type CheckContext = {
	/** Absolute path to the project being gated. */
	cwd: string
	/** Files changed against the baseline, repository-relative. */
	changed: string[]
	/** Every file the project tracks, repository-relative. */
	files: string[]
	read(file: string): Promise<string>
}

export type Rung = {
	command: string
	id: string
	name: string
	/** What this rung proves, printed in the report. */
	proves: string
}

export type RungResult = Rung & {
	result: string
	state: GateState
	note?: string
}
