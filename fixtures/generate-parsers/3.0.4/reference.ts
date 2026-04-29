import { isObject } from '@amritk/helpers/is-object';

/**
* Reference object
*
* A simple object to allow referencing other components in the OpenAPI Description, internally and externally.  The Reference Object is defined by [JSON Reference](https://tools.ietf.org/html/draft-pbryan-zyp-json-ref-03) and follows the same structure, behavior and rules.  For this specification, reference resolution is accomplished as defined by the JSON Reference specification and not by the JSON Schema specification.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#reference-object}
*/
export type ReferenceObject = Record<string, string>;

export const parseReferenceObject = (input: unknown): ReferenceObject => {
  if (!isObject(input)) {
    return {} as unknown as ReferenceObject;
  }
  const result = {
    ...input,
  } as unknown as ReferenceObject;
  for (const key in input) {
    if (/^\\$ref$/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};