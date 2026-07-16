import { buildCoercionPlan } from './build-coercion-plan'
import { parsePathPattern } from './parse-path-pattern'
import type { AnyRouteContract, CompiledInput, CompiledRoute, CompiledValidation, ValidatorCompiler } from './types'

/**
 * Turns a route contract into its compiled runtime form. Everything derivable
 * from the contract — parsed path segments, validators, coercion plans — is
 * built here, once, at startup, so `handle` touches no schema at request time.
 *
 * Response validators are only compiled when response validation is enabled;
 * with it off (the production default) declaring response schemas costs
 * nothing at runtime — they exist purely for OpenAPI and handler typing.
 */
export const compileRoute = (
  contract: AnyRouteContract,
  compile: ValidatorCompiler,
  validateResponses: boolean,
): CompiledRoute => {
  const segments = parsePathPattern(contract.path)
  const request = contract.request

  let responses: Map<number, CompiledValidation> | undefined
  if (validateResponses) {
    responses = new Map()
    for (const [status, response] of Object.entries(contract.responses)) {
      if (response.body !== undefined) {
        responses.set(Number(status), compile(response.body))
      }
    }
  }

  return {
    contract,
    method: contract.method.toUpperCase(),
    segments,
    params: compileInput(request?.params, compile),
    query: compileInput(request?.query, compile),
    body: request?.body !== undefined ? compile(request.body) : undefined,
    responses,
  }
}

const compileInput = (schema: unknown, compile: ValidatorCompiler): CompiledInput | undefined => {
  if (schema === undefined) return undefined
  return { ...compile(schema), coercions: buildCoercionPlan(schema) }
}
