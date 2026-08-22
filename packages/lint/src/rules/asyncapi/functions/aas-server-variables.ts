import { serverVariables } from '../../shared/server-variables'

/**
 * Validates a 2.x Server Object's `variables`. The AsyncAPI and OpenAPI Server
 * Objects are the same shape here, so the implementation is shared — see
 * {@link serverVariables}.
 */
export const aasServerVariables = serverVariables
