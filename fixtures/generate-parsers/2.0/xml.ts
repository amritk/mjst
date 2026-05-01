import { isObject } from '@amritk/helpers/is-object';

/**
* Xml object
*
* A metadata object that allows for more fine-tuned XML model definitions.  When using arrays, XML element names are *not* inferred (for singular/plural forms) and the `name` property should be used to add that information. See examples for expected behavior.
* 
* @see {@link https://swagger.io/specification/v2/#xml-object}
*/
export type XmlObject = {
  /** Replaces the name of the element/attribute used for the described schema property. When defined within the Items Object (`items`), it will affect the name of the individual XML elements within the list. When defined alongside `type` being `array` (outside the `items`), it will affect the wrapping element and only if `wrapped` is `true`. If `wrapped` is `false`, it will be ignored. */
  name?: string;
  /** The URL of the namespace definition. Value SHOULD be in the form of a URL. */
  namespace?: string;
  /** The prefix to be used for the [name](https://swagger.io/specification/v2/#xmlName). */
  prefix?: string;
  /** Declares whether the property definition translates to an attribute instead of an element. Default value is `false`. */
  attribute?: boolean;
  /** MAY be used only for an array definition. Signifies whether the array is wrapped (for example, `<books><book/><book/></books>`) or unwrapped (`<book/><book/>`). Default value is `false`. The definition takes effect only when defined alongside `type` being `array` (outside the `items`). */
  wrapped?: boolean;
};

export const parseXmlObject = (input: unknown): XmlObject => {
  if (!isObject(input)) {
    return {} as unknown as XmlObject;
  }
  const result = {
    ...input,
    ...((value => value === undefined ? {} : { name: value })(typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : undefined))),
    ...((value => value === undefined ? {} : { namespace: value })(typeof input?.namespace === "string" ? input?.namespace : (input?.namespace !== undefined ? String(input?.namespace) : undefined))),
    ...((value => value === undefined ? {} : { prefix: value })(typeof input?.prefix === "string" ? input?.prefix : (input?.prefix !== undefined ? String(input?.prefix) : undefined))),
    ...((value => value === undefined ? {} : { attribute: value })(typeof input?.attribute === "boolean" ? input?.attribute : (input?.attribute !== undefined ? Boolean(input?.attribute) : undefined))),
    ...((value => value === undefined ? {} : { wrapped: value })(typeof input?.wrapped === "boolean" ? input?.wrapped : (input?.wrapped !== undefined ? Boolean(input?.wrapped) : undefined))),
  } as unknown as XmlObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};