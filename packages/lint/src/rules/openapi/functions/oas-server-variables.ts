import { type IServerVariablesOptions, serverVariables } from '../../shared/server-variables'

/**
 * Validates a Server Object's `variables`. The OpenAPI and AsyncAPI Server
 * Objects are the same shape here, so the implementation is shared — see
 * {@link serverVariables}.
 */
export const oasServerVariables = serverVariables

export type { IServerVariablesOptions }
