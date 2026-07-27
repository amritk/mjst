import { defineRoute } from './define-route'

/**
 * The contract behind `formats.test.ts`, in its own module because the compiled
 * engine imports its handlers live: `compileToModule` bakes the schemas into the
 * emitted module but resolves the route objects through `routesImport`, so both
 * engines have to reach the same declaration. Mirrors the arrangement in
 * `compile/compile-to-module.test-utils.ts`.
 */
export const findUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
    query: { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
  },
  responses: { 200: { body: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  handler: ({ params }) => ({ status: 200, body: { id: params.id } }),
})
