import { describe, expect, it } from 'vitest'

import type { CheckContext } from '@/types.js'

import { CHECKS } from '@/checks/registry.js'

// turystack-proof:pattern-data — every pair below is a deliberate violation, held as data so the checks can be proved to fire on it.

/**
 * The fixture pair, for structural checks.
 *
 * The GritQL rules ship one file that must fail and one that must pass, because
 * a rule written from a single example catches that example and silently
 * catches nothing after a refactor. A structural check has exactly the same
 * failure mode, and a worse one on top: it *reimplements* a law rather than
 * executing it, so when it diverges from the law the divergence always favours
 * green.
 *
 * So each check declares two virtual projects here. Nothing is mocked — the
 * check runs its real `run()` against a real `CheckContext`; only the file
 * system is in memory, which is the part that would otherwise make this
 * unaffordable at seventy-odd checks.
 *
 * The test at the bottom is the one that keeps this honest: a check in the
 * registry with no pair here fails the suite. Adding a gate without proving it
 * fires is the omission this whole file exists to prevent.
 */

type Project = Record<string, string>

function contextOf(files: Project, changed?: string[]): CheckContext {
	return {
		changed: changed ?? Object.keys(files),
		cwd: '/virtual',
		files: Object.keys(files),
		async read(file: string) {
			return files[file] ?? ''
		},
	}
}

type Pair = {
	clean: Project
	dirty: Project
	changedClean?: string[]
	changedDirty?: string[]
}

const CASE_OK =
	'{"id":"TC-1","proves":"AC-1","level":"unit","text":"a paid order becomes cancelled","state":"approved"}'
const BOARD_CLEAN = `{"schema":"turystack.board/1","project":"acme","tasks":[{"id":"T-1","covers":["AC-1"],"status":"open","report":null,"cases":[${CASE_OK}]}]}`
const BOARD_DIRTY = `{"schema":"turystack.board/1","project":"acme","tasks":[{"id":"T-1","covers":[],"status":"open","report":null,"cases":[${CASE_OK}]}]}`
const SPEC_SECTION =
	'## Shape\n\n| AC | Given | When | Then |\n|---|---|---|---|\n| AC-9 | the shape half shows the format | it is read | it is not a decision |\n\n## acme\n\n| AC | Given | When | Then |\n|---|---|---|---|\n| AC-1 | a paid order | the operator cancels | it is cancelled |\n\n## Never do\n\n- guess\n'
const CONTROLLER = 'src/features/orders/orders.controller.ts'
const SCHEMA = 'src/features/orders/orders.schema.ts'

const PAIRS: Record<string, Pair> = {
	'acceptance-ids': {
		clean: {
			'.claude/skills/acme-spec/01-definition.md':
				'# Cancel\n\n| AC | Given | When | Then |\n|---|---|---|---|\n| AC-1 | a paid order | the operator cancels | it is cancelled |\n',
		},
		dirty: {
			'.claude/skills/acme-spec/01-definition.md':
				'# Cancel\n\nThe operator can cancel a paid order.\n',
		},
	},

	'acl-coverage': {
		clean: {
			[CONTROLLER]: `class C {\n  @ACL('order:cancel')\n  @Route({ method: 'POST', path: ':orderId::cancel' })\n  async cancel() {}\n}`,
		},
		dirty: {
			[CONTROLLER]: `class C {\n  @Route({ method: 'POST', path: ':orderId::cancel' })\n  async cancel() {}\n}`,
		},
	},

	'adapter-structure': {
		clean: {
			'src/adapters/payment.adapter.ts': 'export class PaymentAdapter {}',
			'src/adapters/payment.port.ts':
				'export type PaymentPort = { charge(): void }',
		},
		dirty: {
			'src/adapters/payment.adapter.ts': 'export class PaymentAdapter {}',
		},
	},

	'auth-gate-placement': {
		clean: {
			'src/orders/orders.page.tsx': 'export function Page() { return null }',
		},
		dirty: {
			'src/orders/orders.page.tsx':
				'export function Page() { if (can("read")) return null }',
		},
	},

	'barrel-shape': {
		clean: {
			'src/components/index.ts': "export * from './button.js'\n",
		},
		dirty: {
			'src/components/index.ts': 'export const VERSION = 1\n',
		},
	},

	// The Shape half's `AC-9` is the template showing the format, not a decision
	// this project made: a clean project stays clean with it in the file.
	'board-covers-spec': {
		clean: {
			'.claude/skills/acme-spec/01-definition.md': SPEC_SECTION,
			'.claude/skills/acme-spec/board/tasks.json': BOARD_CLEAN,
		},
		dirty: {
			'.claude/skills/acme-spec/01-definition.md': SPEC_SECTION,
			'.claude/skills/acme-spec/board/tasks.json': BOARD_DIRTY,
		},
	},

	'board-in-sync': {
		clean: {
			'.claude/skills/acme-spec/board/tasks.json': BOARD_CLEAN,
			'.claude/skills/acme-spec/board/template.html': `<script type="application/json" id="board">${BOARD_CLEAN}</script>`,
		},
		dirty: {
			'.claude/skills/acme-spec/board/tasks.json': BOARD_CLEAN,
			'.claude/skills/acme-spec/board/template.html': `<script type="application/json" id="board">${BOARD_DIRTY}</script>`,
		},
	},

	'board-report-linked': {
		clean: {
			'.claude/skills/acme-spec/board/reports/T-1/report.html': '<html></html>',
			'.claude/skills/acme-spec/board/tasks.json':
				'{"tasks":[{"id":"T-1","covers":["AC-1"],"status":"done","report":"reports/T-1/report.html"}]}',
		},
		dirty: {
			'.claude/skills/acme-spec/board/tasks.json':
				'{"tasks":[{"id":"T-1","covers":["AC-1"],"status":"done","report":null}]}',
		},
	},

	'bootstrap-complete': {
		clean: {
			'.claude/skills/acme-spec/00-overview.md': '# acme',
			'.claude/skills/acme-spec/board/tasks.json': BOARD_CLEAN,
			'.claude/skills/acme-uiux/00-overview.md': '# acme',
			'.claude/turystack.json': '{"project":"acme"}',
		},
		dirty: {
			'.claude/skills/acme-spec/00-overview.md': '# acme',
		},
	},

	'bundle-budget': {
		clean: {
			'.size-limit.json': '[]',
			'vite.config.ts': 'export default {}',
		},
		dirty: {
			'vite.config.ts': 'export default {}',
		},
	},

	'capability-unhappy-paths': {
		clean: {
			'.claude/skills/acme-spec/01-definition.md':
				'# Cancel\n\nnot allowed when the caller lacks the scope.\nnot found when the order does not exist.\nalready cancelled is idempotent.\nblocked by state once shipped.\n',
		},
		dirty: {
			'.claude/skills/acme-spec/01-definition.md':
				'# Cancel\n\nThe user cancels an order.\n',
		},
	},

	'case-test-link': {
		clean: {
			'.claude/skills/acme-spec/board/tasks.json': `{"tasks":[{"id":"T-1","status":"done","casesApprovedBy":"joaogabriel","cases":[${CASE_OK}]}]}`,
			'gate-report.json':
				'{"task":{"id":"T-1"},"backend":{"specs":[{"spec":"TC-1 · AC-1 · a paid order becomes cancelled","test":"cancel.test.ts"}]}}',
		},
		dirty: {
			'.claude/skills/acme-spec/board/tasks.json': `{"tasks":[{"id":"T-1","status":"done","casesApprovedBy":"joaogabriel","cases":[${CASE_OK},{"id":"TC-9","proves":null,"level":"integration","text":"two cancellations racing leave one refusal","state":"approved","addedBy":"joaogabriel"}]}]}`,
			'gate-report.json':
				'{"task":{"id":"T-1"},"backend":{"specs":[{"spec":"TC-1 · AC-1 · a paid order becomes cancelled","test":"cancel.test.ts"}]}}',
		},
	},

	'cases-approved': {
		clean: {
			'.claude/skills/acme-spec/board/tasks.json': `{"tasks":[{"id":"T-1","status":"doing","casesApprovedBy":"joaogabriel","cases":[${CASE_OK}]}]}`,
		},
		dirty: {
			'.claude/skills/acme-spec/board/tasks.json':
				'{"tasks":[{"id":"T-1","status":"doing","casesApprovedBy":null,"cases":[{"id":"TC-1","proves":"AC-1","level":"unit","text":"a paid order becomes cancelled","state":"proposed"}]}]}',
		},
	},

	'component-files': {
		clean: {
			'src/components/button/button.stories.tsx':
				'export default { component: Button }',
			'src/components/button/button.styles.ts':
				'export const buttonStyles = () => ""',
			'src/components/button/button.test.tsx': 'it("renders", () => {})',
			'src/components/button/button.tsx': 'export const Button = () => null',
			'src/components/button/button.types.ts': 'export type ButtonProps = {}',
			'src/components/button/index.ts': "export * from './button.js'",
		},
		dirty: {
			'src/components/button/button.tsx': 'export const Button = () => null',
		},
	},

	'config-extends': {
		clean: {
			'biome.json': '{ "extends": ["@turystack/backend-config"] }',
			'package.json':
				'{ "devDependencies": { "@turystack/backend-config": "1.0.0" } }',
		},
		dirty: {
			'biome.json': '{ "linter": { "enabled": true } }',
			'package.json':
				'{ "devDependencies": { "@turystack/backend-config": "1.0.0" } }',
		},
	},

	'context-recorded': {
		clean: {
			'gate-report.json': JSON.stringify({
				context: [
					{
						kind: 'Capability spec',
						source: 'acme-spec › 01-definition.md',
					},
					{
						kind: 'Domain model',
						source: 'acme-spec › 02-domains.md',
					},
					{
						kind: 'Design',
						source: 'acme-uiux › assets/orders-table.png',
					},
					{
						kind: 'UI/UX rules',
						source: 'acme-uiux › 03-copy.md',
					},
					{
						kind: 'API contract',
						source: 'src/sdk/generated',
					},
				],
			}),
		},
		dirty: {
			'gate-report.json': JSON.stringify({
				context: [
					{
						kind: 'Capability spec',
						source: 'acme-spec › 01-definition.md',
					},
				],
			}),
		},
	},

	'context-resolved': {
		clean: {
			'.claude/skills/acme-spec/01-definition.md': '# Cancel\n\nDecided.\n',
			'.claude/turystack.json': '{"project":"acme"}',
		},
		dirty: {
			'.claude/skills/acme-spec/01-definition.md':
				'todo\n<!-- turystack:unfilled -->\n',
			'.claude/turystack.json': '{}',
		},
	},

	'contract-delta': {
		clean: {
			[SCHEMA]: 'export const orderSchema = z.object({})',
			'src/sdk/generated/index.ts': 'export type Order = {}',
		},
		dirty: {
			[SCHEMA]: 'export const orderSchema = z.object({})',
		},
	},

	'contract-sync': {
		clean: {
			'src/x.tsx': "import type { ButtonProps } from '@turystack/react-web'",
		},
		dirty: {
			'src/x.tsx':
				"import type { ButtonProps } from '@turystack/react-web/src/components/button/button.types.js'",
		},
	},

	'controlled-pair': {
		clean: {
			'src/components/switch/switch.types.ts':
				'export type SwitchProps = { checked?: boolean; onCheckedChange?: (next: boolean) => void }',
		},
		dirty: {
			'src/components/switch/switch.types.ts':
				'export type SwitchProps = { checked?: boolean }',
		},
	},

	'controller-e2e': {
		clean: {
			[CONTROLLER]: 'export class OrdersController {}',
			'src/features/orders/orders.controller.e2e.test.ts':
				'it("cancels", () => {})',
		},
		dirty: {
			[CONTROLLER]: 'export class OrdersController {}',
		},
	},

	correlation: {
		clean: {
			'src/main.ts': 'app.use(correlationId())\napp.listen(3000)',
		},
		dirty: {
			'src/main.ts': 'const app = create()\napp.listen(3000)',
		},
	},

	'data-outcome': {
		clean: {
			'src/features/invoices/invoice-table.tsx':
				"import { useListInvoices } from '@/~sdk'\nconst outcome = useDataOutcome({ query: useListInvoices() })\n",
		},
		dirty: {
			'src/features/invoices/invoice-table.tsx':
				"import { useListInvoices } from '@/~sdk'\nconst { data } = useListInvoices()\n",
		},
	},

	'deep-link': {
		clean: {
			'src/routes/orders.tsx': 'const { orderId } = useParams()',
		},
		dirty: {
			'src/routes/orders.tsx': 'const { order } = useLocation().state',
		},
	},

	'defaults-declared': {
		clean: {
			'src/components/button/button.styles.ts':
				'export const s = cva("", { variants: { size: {} }, defaultVariants: { size: "md" } })',
		},
		dirty: {
			'src/components/button/button.styles.ts':
				'export const s = cva("", { variants: { size: {} } })',
		},
	},

	'design-export': {
		clean: {
			'.claude/skills/acme-uiux/05-assets.md':
				'See assets/orders-cancel.png for the design.',
			'.claude/skills/acme-uiux/assets/orders-cancel.png': 'binary',
		},
		dirty: {
			'.claude/skills/acme-uiux/05-assets.md':
				'See assets/orders-cancel.png for the design.',
		},
	},

	'design-requirement-ids': {
		clean: {
			'.claude/skills/acme-uiux/05-assets.md':
				'# Assets\n\n| UX-DR | Requirement |\n|---|---|\n| UX-DR-1 | the action sits in the row |\n',
		},
		dirty: {
			'.claude/skills/acme-uiux/05-assets.md':
				'# Assets\n\nSee assets/orders.png for the design.\n',
		},
	},

	'domain-placement': {
		clean: {
			'src/domains/orders/cancel.ts':
				"import { Price } from '../billing/index.js'",
		},
		dirty: {
			'src/domains/orders/cancel.ts':
				"import { Price } from '../billing/price.js'",
		},
	},

	'e2e-no-mocks': {
		clean: {
			'src/orders.e2e.test.ts': 'it("x", () => {})',
		},
		dirty: {
			'src/orders.e2e.test.ts': 'vi.mock("./repo")\nit("x", () => {})',
		},
	},

	'e2e-real-infra': {
		clean: {
			'docker-compose.e2e.yml': 'services: {}',
			'src/orders.e2e.test.ts': 'it("x", () => {})',
		},
		dirty: {
			'src/orders.e2e.test.ts': 'it("x", () => {})',
		},
	},

	'entity-decorator': {
		clean: {
			'src/orders/order.entity.ts': '@Entity()\nexport class OrderEntity {}',
		},
		dirty: {
			'src/orders/order.entity.ts': 'export class OrderEntity {}',
		},
	},

	'error-boundary': {
		clean: {
			'src/routes/orders.tsx':
				'export const Route = createRoute({ errorComponent: Boom })',
		},
		dirty: {
			'src/routes/orders.tsx': 'export const Route = createRoute({})',
		},
	},

	'error-envelope': {
		clean: {
			[CONTROLLER]: "throw new NotFoundError('order.not-found')",
		},
		dirty: {
			[CONTROLLER]: "res.status(404).json({ error: 'nope' })",
		},
	},

	'event-identifier': {
		clean: {
			'src/orders/order-cancelled.event.ts':
				"export const e = { eventId: '', name: 'order.cancelled' }",
		},
		dirty: {
			'src/orders/order-cancelled.event.ts':
				"export const e = { name: 'order.cancelled' }",
		},
	},

	'event-name-shape': {
		clean: {
			'src/orders/order-cancelled.event.ts':
				"export const e = { name: 'order.cancelled' }",
		},
		dirty: {
			'src/orders/order-cancelled.event.ts':
				"export const e = { name: 'OrderCancelled' }",
		},
	},

	'example-page-current': {
		clean: {
			'board/example.html':
				'<title>acme — board</title><script type="application/json" id="board">{"tasks":[{"id":"T-1"}]}</script><p>same shell</p>',
			'board/template.html':
				'<!-- turystack:howto start here --><title>{{PROJECT}} — board</title><script type="application/json" id="board">{"tasks":[]}</script><p>same shell</p>',
		},
		dirty: {
			'board/example.html':
				'<title>acme — board</title><script type="application/json" id="board">{"tasks":[{"id":"T-1"}]}</script><p>a shell nobody updated</p>',
			'board/template.html':
				'<title>{{PROJECT}} — board</title><script type="application/json" id="board">{"tasks":[]}</script><p>same shell</p>',
		},
	},

	'fail-loud': {
		clean: {
			'vitest.config.ts': 'export default { test: { passWithNoTests: false } }',
		},
		dirty: {
			'vitest.config.ts': 'export default { test: { passWithNoTests: true } }',
		},
	},

	'file-roles': {
		clean: {
			[SCHEMA]: 'export const orderSchema = z.object({})',
		},
		dirty: {
			[SCHEMA]:
				'export const orderSchema = z.object({})\nexport const cancelRequest = z.object({})',
		},
	},

	'folder-shape': {
		clean: {
			'src/features/orders/orders.controller.ts': 'export class C {}',
		},
		dirty: {
			'src/features/orders/utils/format.ts': 'export const x = 1',
		},
	},

	'generated-untouched': {
		changedClean: [
			'src/features/orders/orders.controller.ts',
		],
		changedDirty: [
			'src/routeTree.gen.ts',
		],
		clean: {
			'src/features/orders/orders.controller.ts': 'export class C {}',
		},
		dirty: {
			'src/routeTree.gen.ts': '// hand edited',
		},
	},

	'handler-e2e': {
		clean: {
			'src/orders/cancel.handler.e2e.test.ts': 'it("x", () => {})',
			'src/orders/cancel.handler.ts': 'export class CancelHandler {}',
		},
		dirty: {
			'src/orders/cancel.handler.ts': 'export class CancelHandler {}',
		},
	},

	'handler-schema': {
		clean: {
			'src/orders/cancel.handler.ts':
				'export class H { run(m) { return schema.parse(m) } }',
		},
		dirty: {
			'src/orders/cancel.handler.ts': 'export class H { run(m) { return m } }',
		},
	},

	'idempotency-fingerprint': {
		clean: {
			'src/orders/cancel.use-case.ts':
				'const idempotencyKey = hash(orderId, reason)',
		},
		dirty: {
			'src/orders/cancel.use-case.ts': 'const idempotencyKey = randomUUID()',
		},
	},

	'integration-no-io': {
		clean: {
			'src/orders.int.test.ts': 'await repository.findById(id)',
		},
		dirty: {
			'src/orders.int.test.ts': "await fetch('https://provider.example')",
		},
	},

	'kebab-case': {
		clean: {
			'src/components/button.tsx': 'export const Button = () => null',
		},
		dirty: {
			'src/components/Button.tsx': 'export const Button = () => null',
		},
	},

	'manual-signed': {
		clean: {
			'gate-report.json': JSON.stringify({
				law: {
					bindings: [
						{
							detector: 'manual',
							id: 'ARC-CON-11',
							note: 'I opened the impact read and compared it against the order’s shipments.',
							reviewer: 'joaogabriel',
						},
					],
				},
			}),
		},
		dirty: {
			'gate-report.json': JSON.stringify({
				law: {
					bindings: [
						{
							detector: 'manual',
							id: 'ARC-CON-11',
							state: 'reviewed',
						},
					],
				},
			}),
		},
	},

	'migration-shape': {
		clean: {
			'migrations/001-add-cancelled-at.ts':
				'export const up = () => {}\nexport const down = () => {}',
		},
		dirty: {
			'migrations/001-add-cancelled-at.ts': 'export const up = () => {}',
		},
	},

	'mock-boundary': {
		clean: {
			'src/orders.test.tsx': "vi.mock('@/sdk')",
		},
		dirty: {
			'src/orders.test.tsx': "vi.spyOn(global, 'fetch')",
		},
	},

	'mutation-invalidates': {
		clean: {
			'src/orders/use-cancel.ts':
				'useMutation({\n  mutationFn: cancel,\n  onSuccess: () => client.invalidateQueries(),\n})',
		},
		dirty: {
			'src/orders/use-cancel.ts': 'useMutation({\n  mutationFn: cancel,\n})',
		},
	},

	'name-channel': {
		clean: {
			'src/orders/toolbar.tsx':
				'<button aria-label="Delete" onClick={x}><TrashIcon /></button>',
		},
		dirty: {
			'src/orders/toolbar.tsx': '<button onClick={x}><TrashIcon /></button>',
		},
	},

	'no-business-verb-in-repo': {
		clean: {
			'src/orders/orders.repository.ts':
				'class R {\n  findById(id) { return id }\n}',
		},
		dirty: {
			'src/orders/orders.repository.ts':
				'class R {\n  cancelOrder(id) { return id }\n}',
		},
	},

	'no-bypass': {
		clean: {
			'src/orders/cancel.ts': 'const x: unknown = 1',
		},
		dirty: {
			'src/orders/cancel.ts':
				'// biome-ignore lint/suspicious/noExplicitAny: unblocking\nconst x: any = 1',
		},
	},

	'no-default-export-route': {
		clean: {
			'src/routes/orders.tsx': 'export const Route = createRoute({})',
		},
		dirty: {
			'src/routes/orders.tsx': 'export default createRoute({})',
		},
	},

	'no-duplicate-primitive': {
		clean: {
			'src/components/order-card/order-card.tsx':
				'export const OrderCard = () => null',
		},
		dirty: {
			'src/components/button/button.tsx':
				"import { Button as Base } from '@turystack/react-web'\nexport const Button = Base",
		},
	},

	'no-fetch-outside-client': {
		clean: {
			'src/orders/use-orders.ts': 'await sdk.orders.list()',
		},
		dirty: {
			'src/orders/use-orders.ts': "await fetch('/orders')",
		},
	},

	'no-literal-fixture': {
		clean: {
			'src/orders/cancel.test.ts': 'const order = orderFactory.build()',
		},
		dirty: {
			'src/orders/cancel.test.ts': 'const orderFixture = {\n  id: "1",\n}',
		},
	},

	'no-nested-retry': {
		clean: {
			'src/adapters/payment.adapter.ts': 'retry(() => call())',
		},
		dirty: {
			'src/adapters/payment.adapter.ts': 'retry(() => withRetry(() => call()))',
		},
	},

	'no-parallel-contract': {
		clean: {
			'src/orders/cancel-button.tsx':
				"import { Button } from '@turystack/react-web'\ntype CancelButtonProps = Omit<ButtonProps, 'onClick'>",
		},
		dirty: {
			'src/orders/cancel-button.tsx':
				"import { Button } from '@turystack/react-web'\ntype CancelButtonProps = { variant: string }",
		},
	},

	'no-reassembled-confirm': {
		clean: {
			'src/orders/cancel.tsx':
				'import { Confirm } from \'@turystack/react-web\'\n<Dialog><Confirm tone="destructive">cancel</Confirm></Dialog>',
		},
		dirty: {
			'src/orders/cancel.tsx':
				'<Dialog>\n  <h2>Cancel order</h2>\n  <button>delete</button>\n</Dialog>',
		},
	},

	'no-rule-in-boundary': {
		clean: {
			[CONTROLLER]: 'return this.cancelOrder.execute(input)',
		},
		dirty: {
			[CONTROLLER]: 'if (order.status !== "paid") { throw new Error("x") }',
		},
	},

	'no-rule-in-use-case': {
		clean: {
			'src/orders/cancel.use-case.ts': 'order.cancel(clock.now())',
		},
		dirty: {
			'src/orders/cancel.use-case.ts':
				'if (order.status === "shipped") { throw new Error("x") }',
		},
	},

	'no-storage-credential': {
		clean: {
			'src/upload.ts': 'const { url } = await sdk.uploads.sign({ name })',
		},
		dirty: {
			'src/upload.ts': 'const accessKeyId = import.meta.env.VITE_S3_KEY',
		},
	},

	'one-catalogue': {
		clean: {
			'src/errors/catalogue.ts':
				"export const ERRORS = createExceptions({ 'order.not-found': 404 })",
		},
		dirty: {
			'src/features/orders/orders.exceptions.ts':
				"export const ORDER_ERRORS = { 'order.not-found': 404 }",
		},
	},

	'realtime-owner': {
		clean: {
			'src/a.ts': "socket.subscribe('orders')",
		},
		dirty: {
			'src/a.ts': "socket.subscribe('orders')",
			'src/b.ts': "socket.subscribe('orders')",
		},
	},

	'reduced-motion': {
		clean: {
			'src/orders/panel.tsx':
				'<div className="motion-safe:transition-all duration-300" />',
		},
		dirty: {
			'src/orders/panel.tsx': '<div className="transition-all duration-300" />',
		},
	},

	'render-smoke': {
		clean: {
			'src/orders/orders.page.test.tsx': 'it("renders", () => {})',
			'src/orders/orders.page.tsx': 'export const Page = () => null',
		},
		dirty: {
			'src/orders/orders.page.tsx': 'export const Page = () => null',
		},
	},

	'report-emitted': {
		clean: {
			'gate-report.json':
				'{ "schema": "turystack.gate-report/1", "ladder": [] }',
		},
		dirty: {
			'gate-report.json': '{ "verdict": "pass" }',
		},
	},

	'required-captures': {
		clean: {
			'gate-report.json': JSON.stringify({
				frontend: {
					screens: [
						{
							captures: [
								{
									image: 'a.png',
									state: 'success',
								},
								{
									image: 'b.png',
									state: 'denied',
								},
							],
							name: 'Cancel',
							required: [
								'success',
								'denied',
							],
						},
					],
				},
			}),
		},
		dirty: {
			'gate-report.json': JSON.stringify({
				frontend: {
					screens: [
						{
							captures: [
								{
									image: 'a.png',
									state: 'success',
								},
							],
							name: 'Cancel',
							required: [
								'success',
								'denied',
							],
						},
					],
				},
			}),
		},
	},

	'resilience-at-port': {
		clean: {
			'src/orders/cancel.use-case.ts': 'await port.charge()',
		},
		dirty: {
			'src/orders/cancel.use-case.ts': 'await retry(() => port.charge())',
		},
	},

	'route-order': {
		clean: {
			[CONTROLLER]: `@Route({ method: 'GET', path: ':id' })\nx()\n@Route({ method: 'DELETE', path: ':id' })\ny()`,
		},
		dirty: {
			[CONTROLLER]: `@Route({ method: 'DELETE', path: ':id' })\nx()\n@Route({ method: 'GET', path: ':id' })\ny()`,
		},
	},

	'route-schemas': {
		clean: {
			[CONTROLLER]: `@Route({ method: 'POST', path: 'orders', body: createOrderRequest })\nasync create() {}`,
		},
		dirty: {
			[CONTROLLER]: `@Route({ method: 'POST', path: 'orders' })\nasync create() {}`,
		},
	},

	'route-shape': {
		clean: {
			[CONTROLLER]: `@Route({ method: 'POST', path: ':orderId::cancel' })\nasync cancel() {}`,
		},
		dirty: {
			[CONTROLLER]: `@Route({ method: 'POST', path: ':orderId/cancel' })\nasync cancel() {}`,
		},
	},

	'route-splitting': {
		clean: {
			'src/routes/a.tsx':
				'export const Route = { component: lazy(() => import("./a-page.js")) }',
			'src/routes/b.tsx': 'export const Route = {}',
			'src/routes/c.tsx': 'export const Route = {}',
		},
		dirty: {
			'src/routes/a.tsx': 'export const Route = {}',
			'src/routes/b.tsx': 'export const Route = {}',
			'src/routes/c.tsx': 'export const Route = {}',
		},
	},

	'rule-id-coverage': {
		clean: {
			'gate-report.json':
				'{"task":{"covers":["AC-1"]},"backend":{"specs":[{"spec":"AC-1 · a paid order is cancelled","test":"cancel.test.ts"}]}}',
		},
		dirty: {
			'gate-report.json':
				'{"task":{"covers":["AC-1"]},"backend":{"specs":[{"spec":"a paid order is cancelled","test":"cancel.test.ts"}]}}',
		},
	},

	'schema-metadata': {
		clean: {
			[SCHEMA]:
				"export const orderSchema = z.object({\n  id: z.string().describe('the order id'),\n})",
		},
		dirty: {
			[SCHEMA]: 'export const orderSchema = z.object({\n  id: z.string(),\n})',
		},
	},

	'schema-strict': {
		clean: {
			[SCHEMA]:
				'export const cancelRequestSchema = z.object({\n  reason: z.string(),\n}).strict()',
		},
		dirty: {
			[SCHEMA]:
				'export const cancelRequestSchema = z.object({\n  reason: z.string(),\n})',
		},
	},

	'sdk-shadow': {
		clean: {
			'src/orders/cancel.ts': 'await sdk.orders.list()',
		},
		dirty: {
			'src/orders/cancel.ts': "await fetch('/api/v1/app/orders')",
		},
	},

	'search-schema': {
		clean: {
			'src/routes/orders.tsx':
				'validateSearch: ordersSearchSchema\nconst { page } = useSearch()',
		},
		dirty: {
			'src/routes/orders.tsx': 'const { page } = useSearch()',
		},
	},

	'secret-scan': {
		clean: {
			'src/config.ts': 'export const key = process.env.STRIPE_KEY',
		},
		dirty: {
			'src/config.ts': "export const key = 'sk_live_abcdefghijklmnop0123'",
		},
	},

	'shared-artifact-placement': {
		clean: {
			'src/features/orders/cancel.ts':
				"import { Price } from '../../shared/price.js'",
		},
		dirty: {
			'src/features/orders/cancel.ts':
				"import { Price } from '../billing/price.js'",
		},
	},

	'shared-harness': {
		clean: {
			'src/a.test.tsx': 'beforeEach(() => reset())\nit("x", () => {})',
			'src/b.test.tsx': 'beforeEach(() => reset())\nit("y", () => {})',
			'src/test-setup.tsx': 'export const reset = () => null',
		},
		dirty: {
			'src/a.test.tsx': 'beforeEach(() => seedA())\nit("x", () => {})',
			'src/b.test.tsx': 'beforeEach(() => seedB())\nit("y", () => {})',
		},
	},

	'shared-setup': {
		clean: {
			'src/a.test.ts': 'beforeEach(() => seed())\nit("x", () => {})',
			'src/b.test.ts': 'beforeEach(() => seed())\nit("y", () => {})',
			'src/test-setup.ts': 'export const seed = () => null',
		},
		dirty: {
			'src/a.test.ts': 'beforeEach(() => seedA())\nit("x", () => {})',
			'src/b.test.ts': 'beforeEach(() => seedB())\nit("y", () => {})',
		},
	},

	'single-registration': {
		clean: {
			'src/a.module.ts': 'register(OrderRepository)',
		},
		dirty: {
			'src/a.module.ts': 'register(OrderRepository)',
			'src/b.module.ts': 'register(OrderRepository)',
		},
	},

	'slots-named': {
		clean: {
			'src/components/card/card.tsx': `const card = tv({
  slots: {
    root: 'card-root flex flex-col',
    cellContent: 'card-cell-content min-w-0',
  },
})
export const Card = () => <div className="card-badge absolute" />`,
		},
		dirty: {
			'src/components/card/card.tsx': `const card = tv({
  slots: {
    root: 'flex flex-col',
    cellContent: 'min-w-0',
  },
})
export const Card = () => <div className="absolute top-0" />`,
		},
	},

	'soft-delete-filter': {
		clean: {
			'src/orders/order.entity.ts':
				'class OrderEntity { deletedAt: Date | null }',
			'src/orders/order.repository.ts':
				'class R { findById(id) { return db.find({ id, deletedAt: null }) } }',
		},
		dirty: {
			'src/orders/order.entity.ts':
				'class OrderEntity { deletedAt: Date | null }',
			'src/orders/order.repository.ts':
				'class R { findById(id) { return db.find(id) } }',
		},
	},

	'spec-test-link': {
		clean: {
			'gate-report.json': JSON.stringify({
				backend: {
					specs: [
						{
							spec: 'A cancelled order cannot be cancelled again',
							state: 'pass',
							test: 'cancel-order.test.ts › rejects a cancelled order',
						},
					],
				},
				frontend: {
					specs: [
						{
							spec: 'The table renders all five outcomes',
							state: 'pass',
							test: 'order-table.test.tsx › renders the five states',
						},
					],
				},
			}),
		},
		dirty: {
			'gate-report.json': JSON.stringify({
				backend: {
					specs: [
						{
							spec: 'A cancelled order cannot be cancelled again',
						},
						{
							spec: 'The confirm lists the blast radius',
							state: 'fail',
							test: 'cancel-confirm.test.tsx › lists it',
						},
					],
				},
			}),
		},
	},

	'spec-unfilled': {
		clean: {
			'.claude/skills/acme-spec/01-definition.md': '# Cancel\n\nDecided.',
		},
		dirty: {
			'.claude/skills/acme-spec/01-definition.md':
				'<!-- turystack:unfilled -->',
		},
	},

	'story-coverage': {
		clean: {
			'src/components/button/button.stories.tsx':
				'export default { component: Button }',
			'src/components/button/button.tsx': 'export const Button = () => null',
		},
		dirty: {
			'src/components/button/button.tsx': 'export const Button = () => null',
		},
	},

	'story-placement': {
		clean: {
			'src/components/button/button.stories.tsx': 'export default {}',
			'src/components/button/button.tsx': 'export const Button = () => null',
		},
		dirty: {
			'src/stories/button.stories.tsx': 'export default {}',
		},
	},

	'styles-export': {
		clean: {
			'src/components/button/button.styles.ts': 'export const s = cva("px-2")',
			'src/components/button/button.tsx': 'export const Button = () => null',
		},
		dirty: {
			'src/components/button/button.tsx':
				'const s = cva("px-2")\nexport const Button = () => null',
		},
	},

	'task-cases': {
		clean: {
			'.claude/skills/acme-spec/board/tasks.json': BOARD_CLEAN,
		},
		dirty: {
			'.claude/skills/acme-spec/board/tasks.json':
				'{"tasks":[{"id":"T-1","title":"Cancel an order","status":"open"}]}',
		},
	},

	'test-bindings': {
		clean: {
			'src/orders/cancel.test.tsx': [
				"it('has no axe violations @axe-clean', () => {})",
				"it('keeps the parts in sync @compound-state', () => {})",
				"it('states the denial @denial-visible', () => {})",
				"it('renders all five @five-outcomes', () => {})",
				"it('exposes its state @state-exposed', () => {})",
			].join('\n'),
			'src/orders/cancel.tsx': 'export const Cancel = () => null',
		},
		dirty: {
			'src/orders/cancel.test.tsx': "it('renders', () => {})",
			'src/orders/cancel.tsx': 'export const Cancel = () => null',
		},
	},

	'test-config-split': {
		clean: {
			'src/orders.e2e.test.ts': 'it("x", () => {})',
			'vitest.config.ts': 'export default {}',
			'vitest.e2e.config.ts': 'export default {}',
		},
		dirty: {
			'src/orders.e2e.test.ts': 'it("x", () => {})',
			'vitest.config.ts': 'export default {}',
		},
	},

	'test-file-placement': {
		clean: {
			'src/orders/orders.test.ts': 'it("x", () => {})',
		},
		dirty: {
			'src/__tests__/orders.test.ts': 'it("x", () => {})',
		},
	},

	'test-levels': {
		clean: {
			[CONTROLLER]: 'export class OrdersController {}',
			'src/features/orders/orders.repository.ts': 'export class R {}',
			'src/orders.e2e.test.ts': 'it("z", () => {})',
			'src/orders.int.test.ts': 'it("y", () => {})',
			'src/orders.test.ts': 'it("x", () => {})',
		},
		dirty: {
			[CONTROLLER]: 'export class OrdersController {}',
			'src/features/orders/orders.repository.ts': 'export class R {}',
			'src/orders.test.ts': 'it("x", () => {})',
		},
	},

	'theme-in-sync': {
		clean: {
			'.claude/skills/acme-uiux/theme/internal.css': ':root{--primary:#2f4a7a}',
			'apps/backoffice/src/internal.css': ':root{--primary:#2f4a7a}',
		},
		dirty: {
			'.claude/skills/acme-uiux/theme/internal.css': ':root{--primary:#2f4a7a}',
			'apps/backoffice/src/internal.css': ':root{--primary:#a8322d}',
		},
	},

	'theme-override-shape': {
		clean: {
			'.claude/skills/acme-uiux/theme/internal.css':
				':root{--primary:#2f4a7a}\n.button{letter-spacing:0.04em}\n.dark .button{color:#fff}\n.button[data-variant="destructive"]{border-color:var(--destructive)}',
		},
		dirty: {
			'.claude/skills/acme-uiux/theme/internal.css':
				'.card > div span{color:red}\n.button{color:blue !important}',
		},
	},

	'theme-per-system': {
		clean: {
			'.claude/skills/acme-uiux/07-theme.md':
				'| System | File |\n|---|---|\n| internal | `theme/internal.css` |\n',
			'.claude/skills/acme-uiux/theme/internal.css': ':root{--primary:#2f4a7a}',
		},
		dirty: {
			'.claude/skills/acme-uiux/07-theme.md':
				'| System | File |\n|---|---|\n| product | `theme/product.css` |\n',
			'.claude/skills/acme-uiux/theme/internal.css': ':root{--primary:#2f4a7a}',
		},
	},

	'timeout-declared': {
		clean: {
			'src/adapters/payment.adapter.ts':
				"await fetch('https://p.example', { signal })",
		},
		dirty: {
			'src/adapters/payment.adapter.ts': "await fetch('https://p.example')",
		},
	},

	'token-role-names': {
		clean: {
			'.claude/skills/acme-uiux/01-brand.md': '--color-primary: #1e6fd9;',
		},
		dirty: {
			'.claude/skills/acme-uiux/01-brand.md': '--color-blue: #1e6fd9;',
		},
	},

	'token-scheme-parity': {
		clean: {
			'.claude/skills/acme-uiux/01-brand.md':
				':root { --color-primary: #1e6fd9; --color-surface: #fff; }\n@media (prefers-color-scheme: dark) { --color-primary: #7db1f5; --color-surface: #0b1220; }',
		},
		dirty: {
			'.claude/skills/acme-uiux/01-brand.md':
				':root { --color-primary: #1e6fd9; --color-surface: #fff; }\n@media (prefers-color-scheme: dark) { --color-primary: #7db1f5; }',
		},
	},

	'transition-table': {
		clean: {
			'.claude/skills/acme-spec/02-domains.md':
				'# Order\n\n| from | to | when |\n|---|---|---|\n| paid | cancelled | before shipping |',
		},
		dirty: {
			'.claude/skills/acme-spec/02-domains.md':
				'# Order\n\nAn order can be cancelled.',
		},
	},

	'uiux-unfilled': {
		clean: {
			'.claude/skills/acme-uiux/01-brand.md': '--color-primary: #1e6fd9;',
		},
		dirty: {
			'.claude/skills/acme-uiux/01-brand.md': '<!-- turystack:unfilled -->',
		},
	},

	'unit-no-infra': {
		clean: {
			'src/orders.test.ts': 'const repository = fakeRepository()',
		},
		dirty: {
			'src/orders.test.ts': 'const db = new PrismaClient()',
		},
	},

	'use-case-shape': {
		clean: {
			'src/orders/cancel.use-case.ts':
				'class C {\n  execute(input) { return input }\n}',
		},
		dirty: {
			'src/orders/cancel.use-case.ts':
				'class C {\n  execute(input) { return input }\n  preview(input) { return input }\n}',
		},
	},

	'util-tested': {
		clean: {
			'src/orders/format.utils.test.ts': 'it("formats", () => {})',
			'src/orders/format.utils.ts': 'export const format = () => ""',
		},
		dirty: {
			'src/orders/format.utils.ts': 'export const format = () => ""',
		},
	},

	'variant-union-parity': {
		clean: {
			'src/components/button/button.styles.ts':
				'export const s = cva("", {\n  variants: {\n    variant: {\n      solid: "",\n      ghost: "",\n    },\n  },\n})',
			'src/components/button/button.types.ts':
				"export type ButtonVariant = 'solid' | 'ghost'",
		},
		dirty: {
			'src/components/button/button.styles.ts':
				'export const s = cva("", {\n  variants: {\n    variant: {\n      solid: "",\n      ghost: "",\n    },\n  },\n})',
			'src/components/button/button.types.ts':
				"export type ButtonVariant = 'solid'",
		},
	},

	'webhook-signature': {
		clean: {
			'src/webhooks/stripe.controller.ts':
				'export class W { handle(body, sig) { return verifySignature(body, sig) } }',
		},
		dirty: {
			'src/webhooks/stripe.controller.ts':
				'export class W { handle(body) { return body } }',
		},
	},
}

describe('every structural check fires on its own negative fixture', () => {
	for (const check of CHECKS) {
		const pair = PAIRS[check.id]

		if (!pair) {
			continue
		}

		it(`gate:${check.id} fires on the dirty project`, async () => {
			const result = await check.run(contextOf(pair.dirty, pair.changedDirty))

			// `warn` counts as fired: a few checks deliberately warn rather than fail
			// because whether the finding blocks *this* task is the harness's call.
			// What never counts is `pass` or `skipped` — those are the states that
			// would let a broken detector look like a healthy project.
			expect(
				result.state,
				`${check.id} reported ${result.state}: ${result.summary}`,
			).toMatch(/^(?:fail|warn)$/)
			expect(result.violations.length).toBeGreaterThan(0)
		})

		it(`gate:${check.id} passes the clean project`, async () => {
			const result = await check.run(contextOf(pair.clean, pair.changedClean))

			expect(
				result.violations.map((violation) => violation.message),
				`${check.id} should be clean here`,
			).toEqual([])
			expect(result.state).not.toBe('fail')
		})
	}
})

/**
 * The check on the checks.
 *
 * Every earlier defect in this system was a verifier that passed when it should
 * have failed. A gate added to the registry with no fixture pair is the same
 * shape of hole — it would report `pass` on every project forever and nobody
 * would notice, because passing is what it looks like when it works.
 */
describe('the registry and this file agree', () => {
	it('every registered check has a fixture pair', () => {
		const missing = CHECKS.filter((check) => !PAIRS[check.id]).map(
			(check) => check.id,
		)

		expect(
			missing,
			'add a dirty/clean pair for these before shipping them',
		).toEqual([])
	})

	it('every fixture pair names a registered check', () => {
		const ids = new Set(CHECKS.map((check) => check.id))
		const orphans = Object.keys(PAIRS).filter((id) => !ids.has(id))

		expect(orphans, 'these pairs test nothing').toEqual([])
	})
})
