import { type HeaderObject, parseHeaderObject } from './header';
import { type ReferenceObject, parseReferenceObject } from './reference';
import { isObject } from 'mjst-helpers/is-object';

/**
* Encoding object
*
* A single encoding definition applied to a single schema property. See [Appendix B](#appendix-b-data-type-conversion) for a discussion of converting values of various types to string representations.  Properties are correlated with `multipart` parts using the [`name` parameter](https://www.rfc-editor.org/rfc/rfc7578#section-4.2) of `Content-Disposition: form-data`, and with `application/x-www-form-urlencoded` using the query string parameter names. In both cases, their order is implementation-defined.  See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns for form media types.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#encoding-object}
*/
export type EncodingObject = {
  /** The `Content-Type` for encoding a specific property. The value is a comma-separated list, each element of which is either a specific media type (e.g. `image/png`) or a wildcard media type (e.g. `image/*`). Default value depends on the property type as shown in the table below. */
  contentType?: string;
  /** A map allowing additional information to be provided as headers. `Content-Type` is described separately and SHALL be ignored in this section. This field SHALL be ignored if the request body media type is not a `multipart`. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** Describes how a specific property value will be serialized depending on its type. See [Parameter Object](https://spec.openapis.org/oas/v3.0.4#parameter-object) for details on the [`style`](https://spec.openapis.org/oas/v3.0.4#parameter-style) field. The behavior follows the same values as `query` parameters, including default values. Note that the initial `?` used in query strings is not used in `application/x-www-form-urlencoded` message bodies, and MUST be removed (if using an RFC6570 implementation) or simply not added (if constructing the string manually). This field SHALL be ignored if the request body media type is not `application/x-www-form-urlencoded`. */
  style?: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  /** When this is true, property values of type `array` or `object` generate separate parameters for each value of the array, or key-value-pair of the map. For other types of properties this field has no effect. When [`style`](https://spec.openapis.org/oas/v3.0.4#encoding-style) is `"form"`, the default value is `true`. For all other styles, the default value is `false`. Note that despite `false` being the default for `deepObject`, the combination of `false` with `deepObject` is undefined. This field SHALL be ignored if the request body media type is not `application/x-www-form-urlencoded`. */
  explode?: boolean;
  /** When this is true, parameter values are serialized using reserved expansion, as defined by [RFC6570](https://datatracker.ietf.org/doc/html/rfc6570#section-3.2.3), which allows [RFC3986's reserved character set](https://datatracker.ietf.org/doc/html/rfc3986#section-2.2), as well as percent-encoded triples, to pass through unchanged, while still percent-encoding all other disallowed characters (including `%` outside of percent-encoded triples). Applications are still responsible for percent-encoding reserved characters that are [not allowed in the query string](https://datatracker.ietf.org/doc/html/rfc3986#section-3.4) (`[`, `]`, `#`), or have a special meaning in `application/x-www-form-urlencoded` (`-`, `&`, `+`); see Appendices [C](https://spec.openapis.org/oas/v3.0.4#appendix-c-using-rfc6570-based-serialization) and [E](https://spec.openapis.org/oas/v3.0.4#appendix-e-percent-encoding-and-form-media-types) for details. The default value is `false`. This field SHALL be ignored if the request body media type is not `application/x-www-form-urlencoded`. */
  allowReserved?: boolean;
};

export const parseEncodingObject = (input: unknown): EncodingObject => {
  if (!isObject(input)) return {} as EncodingObject;
  return {
    ...input,
    ...(input.contentType !== undefined && { contentType: typeof input?.contentType === "string" ? input?.contentType : String(input?.contentType) }),
    ...(input.headers !== undefined && { headers: isObject(input?.headers) ? input?.headers : typeof input?.headers === "object" && input?.headers !== null ? input?.headers : {} }),
    ...(input.style !== undefined && { style: typeof input?.style === "string" && ["form","spaceDelimited","pipeDelimited","deepObject"].includes(input?.style as never) ? input?.style : String(input?.style) }),
    ...(input.explode !== undefined && { explode: typeof input?.explode === "boolean" ? input?.explode : Boolean(input?.explode) }),
    ...(input.allowReserved !== undefined && { allowReserved: typeof input?.allowReserved === "boolean" ? input?.allowReserved : Boolean(input?.allowReserved) }),
  } as unknown as EncodingObject;
}