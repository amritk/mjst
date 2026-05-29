import { createContext } from '#compiler/create-context'
import { generateSchemaCode } from '#compiler/generate-schema-code'

/**
 * The compact runtime helpers we splice into a compiled validator only when the
 * schema actually needs them. Keeping them as source strings (rather than
 * closure references) lets `new Function` JIT the whole validator as one unit,
 * which is both faster to call and cheaper to parse than wiring up extra
 * closure variables.
 */
const DEEP_EQUAL_SOURCE = `function deepEqual(a,b){if(a===b)return true;if(typeof a!=="object"||typeof b!=="object"||a===null||b===null)return false;var aa=Array.isArray(a),ab=Array.isArray(b);if(aa!==ab)return false;if(aa){if(a.length!==b.length)return false;for(var i=0;i<a.length;i++)if(!deepEqual(a[i],b[i]))return false;return true;}var ka=Object.keys(a);if(ka.length!==Object.keys(b).length)return false;for(var i=0;i<ka.length;i++){var k=ka[i];if(!Object.prototype.hasOwnProperty.call(b,k)||!deepEqual(a[k],b[k]))return false;}return true;}`

const UNIQUE_SOURCE = `function unique(a){var len=a.length;if(len<2)return true;for(var i=0;i<len;i++)for(var j=i+1;j<len;j++)if(deepEqual(a[i],a[j]))return false;return true;}`

/**
 * Compiles a JSON Schema into a specialized validator function.
 *
 * The whole validator — type checks, nested loops, `$ref` functions, and any
 * runtime helpers — is emitted as a single block of JavaScript and realized
 * with `new Function`. Everything that cannot be a source literal (regexes,
 * enum sets, deep-equal constants) is passed in once through the `h` closure
 * argument, so no per-call allocation or recompilation happens.
 *
 * @param schema - The JSON Schema (any value; booleans and `$ref`s are allowed)
 * @param formats - Enabled string formats, or `'all'`
 * @param emitErrors - `true` builds an error-collecting validator; `false`
 *   builds a zero-allocation boolean guard that returns on the first failure
 * @returns The compiled function. In error mode it returns
 *   `true | { valid: false, errors }`; in boolean mode it returns a `boolean`.
 */
export const buildValidator = (
  schema: unknown,
  formats: 'all' | ReadonlySet<string>,
  emitErrors: boolean,
): ((input: unknown) => unknown) => {
  const ctx = createContext(schema, formats, emitErrors)

  // Lazily allocate the error array: `errs` starts null and is only created
  // when the first error is pushed. Valid input — the common case — therefore
  // never allocates, which is where Ajv's first-error path otherwise has an
  // edge. `errs` lives at factory scope so `$ref` functions can push into it
  // without threading it through every call (validation is synchronous and
  // non-reentrant, so a single shared slot is safe and is reset per call).
  ctx.fail = emitErrors
    ? (message, pathExpr) => `(errs||(errs=[])).push({message:${message},path:${pathExpr}});`
    : () => 'return false;'

  // The root document is validated against itself, so local `$ref`s resolve
  // from `schema`. The root path is the empty string (JSON Pointer root).
  const rootCode = generateSchemaCode(ctx, schema, 'data', '""')

  let preamble = ''
  if (ctx.needsDeepEqual) preamble += DEEP_EQUAL_SOURCE
  if (ctx.needsUnique) preamble += UNIQUE_SOURCE

  // Ref functions are emitted at factory scope (not inside `validate`) so the
  // closures are created once at compile time, never per validation call.
  const refDecls = ctx.refDecls.join('')

  const body = emitErrors
    ? `errs=null;${rootCode}return errs?{valid:false,errors:errs}:true;`
    : `${rootCode}return true;`

  // In error mode `errs` is a single factory-scoped slot shared with the ref
  // functions; `validate` resets it on entry.
  const errsDecl = emitErrors ? 'var errs;' : ''
  const source = `${preamble}${errsDecl}${refDecls}function validate(data){${body}}return validate;`

  // eslint-disable-next-line no-new-func — generating code is the entire point.
  const factory = new Function('h', source) as (h: unknown[]) => (input: unknown) => unknown
  return factory(ctx.hoist)
}
