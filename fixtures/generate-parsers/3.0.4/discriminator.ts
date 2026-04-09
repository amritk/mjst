import { isObject } from 'mjst-helpers/is-object';

/**
* Discriminator object
*
* When request bodies or response payloads may be one of a number of different schemas, a Discriminator Object gives a hint about the expected schema of the document. This hint can be used to aid in serialization, deserialization, and validation. The Discriminator Object does this by implicitly or explicitly associating the possible values of a named property with alternative schemas.  Note that `discriminator` MUST NOT change the validation outcome of the schema.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#discriminator-object}
*/
export type DiscriminatorObject = {
  /** **REQUIRED**. The name of the property in the payload that will hold the discriminating value. This property SHOULD be required in the payload schema, as the behavior when the property is absent is undefined. */
  propertyName: string;
  /** An object to hold mappings between payload values and schema names or URI references. */
  mapping?: Record<string, string>;
};

export const parseDiscriminatorObject = (input: unknown): DiscriminatorObject => {
  if (!isObject(input)) return {
        propertyName: "",
      };
  const _propertyName = input.propertyName;
  const _mapping = input.mapping;
  if (typeof _propertyName === "string" && (_mapping === undefined || isObject(_mapping))) return { ...input } as DiscriminatorObject;
  return {
    ...input,
    propertyName: typeof _propertyName === "string" ? _propertyName : (_propertyName !== undefined ? String(_propertyName) : ""),
    ...(_mapping !== undefined && { mapping: isObject(_mapping) ? _mapping : typeof _mapping === "object" && _mapping !== null ? _mapping : {} }),
  } as unknown as DiscriminatorObject;
}