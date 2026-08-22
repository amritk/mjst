import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'

/** Options for {@link asyncApiSecurity}: which object the requirement hangs off, for the message. */
export type IAsyncApiSecurityOptions = {
  objectType: 'Server' | 'Operation'
}

// The four OAuth2 flows a scope can be declared in.
const OAUTH2_FLOWS = ['implicit', 'password', 'clientCredentials', 'authorizationCode'] as const

const SECURITY_SCHEMES_REF = '#/components/securitySchemes/'

/**
 * Every scope name declared across an OAuth2 security scheme's flows. Returned as
 * a `Set`: both the scheme's scope list and the requirement's are document-sized,
 * so a linear membership test per requested scope made the rule quadratic — an
 * 8000-scope scheme cost seconds.
 */
const declaredScopes = (flows: unknown): ReadonlySet<string> => {
  const scopes = new Set<string>()
  if (!isObject(flows)) return scopes
  for (const name of OAUTH2_FLOWS) {
    const flow = flows[name]
    if (!isObject(flow) || !isObject(flow['scopes'])) continue
    for (const scope of Object.keys(flow['scopes'])) scopes.add(scope)
  }
  return scopes
}

/**
 * Decodes one JSON Pointer segment of a `$ref`: percent-escapes first (the
 * fragment is a URI), then `~1`/`~0`. The `$ref` is document text, so a
 * malformed escape like `%zz` is something an author can write, and
 * `decodeURIComponent` throws `URIError` on it — which replaced a real finding
 * with an internal-error diagnostic on the wrong node. An undecodable segment is
 * compared as written instead.
 */
const pointerSegment = (segment: string): string => {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // Not valid percent-encoding — compare the segment literally.
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** The `components.securitySchemes` map of the raw document, or an empty one. */
const securitySchemes = (data: unknown): Record<string, unknown> => {
  const components = isObject(data) ? data['components'] : undefined
  const schemes = isObject(components) ? components['securitySchemes'] : undefined
  return isObject(schemes) ? schemes : {}
}

// `Object.hasOwn`, not `in`: scheme names come from the document, so a scheme
// named `toString` or `constructor` would otherwise be found on
// `Object.prototype` and a genuinely undefined one go unreported.
const isDeclared = (schemes: Record<string, unknown>, name: string): boolean => Object.hasOwn(schemes, name)

/**
 * Checks that a security entry points at a security scheme the document
 * declares. The two spec majors spell that entry differently, so the shape
 * decides which check runs:
 *
 * - **2.x** — a Security Requirement Object: `{ <schemeName>: [<scope>, …] }`.
 *   Every key must name a declared scheme, and for an OAuth2 scheme every
 *   requested scope must be one its flows declare.
 * - **3.x** — a Security Scheme Object or a Reference to one. A reference must
 *   point into `#/components/securitySchemes/` and name a scheme that exists; an
 *   inline scheme carries its own definition and has nothing to cross-check
 *   (the structural rules validate its shape).
 *
 * The lookup goes through the raw document, since a requirement names its scheme
 * by key rather than by holding it.
 */
export const asyncApiSecurity: RulesetFunction<unknown, IAsyncApiSecurityOptions> = (
  entry,
  options,
  context,
): IFunctionResult[] => {
  if (!isObject(entry)) return []
  const objectType = options?.objectType ?? 'Operation'
  const schemes = securitySchemes(context.document.data)

  // 3.x: a Reference Object standing in for a security scheme.
  const ref = entry['$ref']
  if (typeof ref === 'string') {
    if (!ref.startsWith(SECURITY_SCHEMES_REF)) {
      return [
        {
          message: `${objectType} security must reference "${SECURITY_SCHEMES_REF}…", not "${ref}"`,
          path: [...context.path, '$ref'],
        },
      ]
    }
    const name = pointerSegment(ref.slice(SECURITY_SCHEMES_REF.length))
    return isDeclared(schemes, name)
      ? []
      : [
          {
            message: `${objectType} security requirement "${name}" is not a defined security scheme`,
            path: [...context.path, '$ref'],
          },
        ]
  }

  // 3.x: an inline Security Scheme Object defines itself — nothing to look up.
  if (typeof entry['type'] === 'string') return []

  // 2.x: a Security Requirement Object. Only array-valued keys are scope lists;
  // anything else is a shape the structural schema reports on, and guessing at it
  // here would turn one structural error into a pile of phantom scheme names.
  const results: IFunctionResult[] = []
  for (const key of Object.keys(entry)) {
    const requested = entry[key]
    if (!Array.isArray(requested)) continue
    if (!isDeclared(schemes, key)) {
      results.push({
        message: `${objectType} security requirement "${key}" is not a defined security scheme`,
        path: [...context.path, key],
      })
      continue
    }
    const scheme = schemes[key]
    if (!isObject(scheme) || scheme['type'] !== 'oauth2') continue
    const available = declaredScopes(scheme['flows'])
    requested.forEach((scope, index) => {
      if (typeof scope === 'string' && !available.has(scope)) {
        results.push({
          message: `Security scope "${scope}" is not declared by the "${key}" scheme. Available: [${[...available].join(', ')}]`,
          path: [...context.path, key, index],
        })
      }
    })
  }
  return results
}
