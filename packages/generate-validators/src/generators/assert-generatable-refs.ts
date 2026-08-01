import { collectEmittedRefs } from './collect-emitted-refs'

/**
 * The `$ref` forms `@amritk/helpers/walk-ref-graph` actually queues, and so the
 * only ones a generated file exists for: an in-document pointer or anchor
 * (`#/$defs/foo`, `#contact`) and an absolute HTTP(S) URI keyed into `$defs`.
 *
 * Everything else — a relative path (`int.json`, `node`, `folder/x.json`), an
 * absolute path (`/absref/foobar.json`), a URN (`urn:uuid:…`) — only resolves by
 * applying the enclosing `$id` as a base URI, which this pipeline does not do.
 */
const isGeneratableRef = (ref: string): boolean =>
  ref.startsWith('#') || ref.startsWith('http://') || ref.startsWith('https://')

/**
 * Throws when a schema would make the emitter call a validator that no file
 * defines.
 *
 * The walker refuses an unresolvable `#`/HTTP `$ref` already, so those never get
 * this far. A ref written against an `$id` does: the walker's queue skips it
 * (nothing in the document is keyed by `int.json`), the import collector skips it
 * for the same reason — and the emitter, which only ever looks at the ref
 * *string*, happily writes `validateIntJson(input, _path)` anyway. The result is
 * generated TypeScript that does not compile, which is a loud failure in the
 * wrong place: it lands in the consumer's build, long after the schema that
 * caused it is out of sight.
 *
 * Stopping here instead puts the failure next to its cause and names the ref, the
 * same answer the resolvable-but-unsupported paths already give. Resolving these
 * refs properly means tracking `$id` base URIs through the document, which is a
 * separate feature — until it exists, refusing is the honest report.
 */
export const assertGeneratableRefs = (schema: unknown, typeName: string): void => {
  for (const ref of collectEmittedRefs(schema)) {
    if (isGeneratableRef(ref)) continue
    throw new Error(
      `[${typeName}] unsupported $ref "${ref}": it only resolves by applying an enclosing "$id" as a base URI, ` +
        'which this generator does not do, so the validator it would call is never emitted. Rewrite the ref as an ' +
        'in-document pointer (e.g. "#/$defs/name") or an absolute http(s) URI keyed in "$defs", or validate this ' +
        'schema with the runtime interpreter instead.',
    )
  }
}
