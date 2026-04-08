import { isObject } from 'mjst-helpers/is-object';

/**
* Reference object
*
* A simple object to allow referencing other components in the OpenAPI Description, internally and externally.  The `$ref` string value contains a URI [RFC3986](https://tools.ietf.org/html/rfc3986), which identifies the value being referenced.  See the rules for resolving [Relative References](#relative-references-in-api-description-uris).
* 
* @see {@link https://spec.openapis.org/oas/v3.2#reference-object}
*/
export type ReferenceObject = {
  $ref?: string;
  /** A short summary which by default SHOULD override that of the referenced component. If the referenced object-type does not allow a `summary` field, then this field has no effect. */
  summary?: string;
  /** A description which by default SHOULD override that of the referenced component. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. If the referenced object-type does not allow a `description` field, then this field has no effect. */
  description?: string;
};

export const parseReferenceObject = (input: unknown): ReferenceObject => {
  if (!isObject(input)) return {} as ReferenceObject;
  const _$ref = input.$ref;
  const _summary = input.summary;
  const _description = input.description;
  if ((_$ref === undefined || typeof _$ref === "string") && (_summary === undefined || typeof _summary === "string") && (_description === undefined || typeof _description === "string")) return input as ReferenceObject;
  return {
    ...input,
    ...(_$ref !== undefined && { $ref: typeof _$ref === "string" ? _$ref : String(_$ref) }),
    ...(_summary !== undefined && { summary: typeof _summary === "string" ? _summary : String(_summary) }),
    ...(_description !== undefined && { description: typeof _description === "string" ? _description : String(_description) }),
  } as unknown as ReferenceObject;
}