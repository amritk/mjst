import { defineContract } from './define-contract'
import { requireContext } from './require-context'
import { routeImplementer } from './route-implementer'
import { secureRoutes, securityGuard } from './secure-routes'
import type { AnyRouteContract, ContextFactoryInput, ContextGuardInput } from './types'

/**
 * The differential fixture for `secureRoutes`: a document-level default guard,
 * a per-operation admin override, and a public opt-out — compiled and run
 * through both engines so the merged `contract.guards` prove identical.
 */

export type SecureContext = { readonly session: { readonly role: string } | null }

/** Session resolved from a header, so requests drive the guards deterministically. */
export const createSecureContext = ({ request }: ContextFactoryInput): SecureContext => {
  const role = request.header('x-role')
  return { session: role === undefined ? null : { role } }
}

const unauthorized = { status: 401, body: { error: 'unauthorized' } } as const
const forbidden = { status: 403, body: { error: 'forbidden' } } as const

const requireSession = requireContext(
  (ctx: ContextGuardInput<SecureContext>) => ctx.context.session !== null,
  unauthorized,
)
const requireAdmin = requireContext(
  (ctx: ContextGuardInput<SecureContext>) => ctx.context.session?.role === 'admin',
  forbidden,
)

/** The schemes carry both their OpenAPI shape and the guard that enforces them. */
export const securitySchemes = {
  bearerAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireSession },
  adminAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireAdmin },
} as const

/** Document-level default: every route needs a session unless it opts out. */
export const documentSecurity = [{ bearerAuth: [] }]

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const
const roleSchema = {
  type: 'object',
  properties: { role: { type: 'string' } },
  required: ['role'],
  additionalProperties: false,
} as const

const profile = defineContract({
  method: 'get',
  path: '/profile',
  responses: { 200: { body: roleSchema }, 401: { body: errorSchema }, 403: { body: errorSchema } },
})

const adminPanel = defineContract({
  method: 'get',
  path: '/admin',
  security: [{ adminAuth: [] }], // overrides the document default
  responses: { 200: { body: roleSchema }, 401: { body: errorSchema }, 403: { body: errorSchema } },
})

const health = defineContract({
  method: 'get',
  path: '/health',
  security: [], // public opt-out
  responses: {
    200: { body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
  },
})

const implement = routeImplementer<SecureContext>()

const secured = secureRoutes(
  [
    implement(profile, ({ context }) => ({ status: 200, body: { role: context.session?.role ?? 'unknown' } })),
    implement(adminPanel, ({ context }) => ({ status: 200, body: { role: context.session?.role ?? 'unknown' } })),
    implement(health, () => ({ status: 200, body: { ok: true } })),
  ],
  { securitySchemes, security: documentSecurity },
)

// Exported individually so the compiled module can import each by name.
const at = (index: number): AnyRouteContract => {
  const route = secured[index]
  if (route === undefined) throw new Error(`secureRoutes returned no route at ${index}`)
  return route
}
export const profileRoute = at(0)
export const adminRoute = at(1)
export const healthRoute = at(2)
