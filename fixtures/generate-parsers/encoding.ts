import type { ReferenceObject } from './reference';
import { type HeaderObject, parseHeaderObject } from './header';
import { type SpecificationExtensionsObject, parseSpecificationExtensionsObject } from './specification-extensions';
import { type StylesForFormObject, parseStylesForFormObject } from './styles-for-form';
import { validateRecord } from './validators/validate-record';
import { isObject } from './helpers/is-object';

/**
* Encoding object
*
* A single encoding definition applied to a single schema property.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#encoding-object}
*/
export type EncodingObject = {
  /** The Content-Type for encoding a specific property. Default value depends on the property type: for `object` - `application/json`;  for `array` – the default is defined based on the inner type; for all other cases the default is `application/octet-stream`. The value can be a specific media type (e.g. `application/json`), a wildcard media type (e.g. `image/*`), or a comma-separated list of the two types. */
  contentType?: string;
  /** A map allowing additional information to be provided as headers, for example `Content-Disposition`.  `Content-Type` is described separately and SHALL be ignored in this section. This property SHALL be ignored if the request body media type is not a `multipart`. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** Describes how a specific property value will be serialized depending on its type.  See [Parameter Object](https://spec.openapis.org/oas/v3.1#parameter-object) for details on the [`style`](https://spec.openapis.org/oas/v3.1#parameterStyle) property. The behavior follows the same values as `query` parameters, including default values. This property SHALL be ignored if the request body media type is not `application/x-www-form-urlencoded` or `multipart/form-data`. If a value is explicitly defined, then the value of [`contentType`](https://spec.openapis.org/oas/v3.1#encodingContentType) (implicit or explicit) SHALL be ignored. */
  style?: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  /** When this is true, property values of type `array` or `object` generate separate parameters for each value of the array, or key-value-pair of the map.  For other types of properties this property has no effect. When [`style`](https://spec.openapis.org/oas/v3.1#encodingStyle) is `form`, the default value is `true`. For all other styles, the default value is `false`. This property SHALL be ignored if the request body media type is not `application/x-www-form-urlencoded` or `multipart/form-data`. If a value is explicitly defined, then the value of [`contentType`](https://spec.openapis.org/oas/v3.1#encodingContentType) (implicit or explicit) SHALL be ignored. */
  explode?: boolean;
  /** Determines whether the parameter value SHOULD allow reserved characters, as defined by [RFC3986](https://tools.ietf.org/html/rfc3986#section-2.2) `:/?#[]@!$&'()*+,;=` to be included without percent-encoding. The default value is `false`. This property SHALL be ignored if the request body media type is not `application/x-www-form-urlencoded` or `multipart/form-data`. If a value is explicitly defined, then the value of [`contentType`](https://spec.openapis.org/oas/v3.1#encodingContentType) (implicit or explicit) SHALL be ignored. */
  allowReserved?: boolean;
};

export const parseEncodingObject = (input: unknown): EncodingObject => {
  if (!isObject(input)) return {};
  const _headers = input.headers;
  return {
    ...input,
    ...(input.contentType !== undefined && { contentType: typeof input?.contentType === "string" ? input?.contentType : String(input?.contentType) }),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeaderObject) }),
    ...(input.style !== undefined && { style: ["form","spaceDelimited","pipeDelimited","deepObject"].includes(input?.style) ? input?.style : "form" }),
    ...(input.explode !== undefined && { explode: typeof input?.explode === "boolean" ? input?.explode : Boolean(input?.explode) }),
    ...(input.allowReserved !== undefined && { allowReserved: typeof input?.allowReserved === "boolean" ? input?.allowReserved : Boolean(input?.allowReserved) }),
  };
}