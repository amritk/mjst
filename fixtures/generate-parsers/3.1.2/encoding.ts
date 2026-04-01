import type { ReferenceObject } from './reference';
import { type HeaderObject, parseHeaderObject } from './header';
import { type StylesForFormObject, parseStylesForFormObject } from './styles-for-form';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

/**
* Encoding object
*
* A single encoding definition applied to a single schema property. See [Appendix B](#appendix-b-data-type-conversion) for a discussion of converting values of various types to string representations.  Properties are correlated with `multipart` parts using the [`name` parameter](https://www.rfc-editor.org/rfc/rfc7578#section-4.2) of `Content-Disposition: form-data`, and with `application/x-www-form-urlencoded` using the query string parameter names. In both cases, their order is implementation-defined.  See [Appendix E](#appendix-e-percent-encoding-and-form-media-types) for a detailed examination of percent-encoding concerns for form media types.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#encoding-object}
*/
export type EncodingObject = {
  /** The `Content-Type` for encoding a specific property. The value is a comma-separated list, each element of which is either a specific media type (e.g. `image/png`) or a wildcard media type (e.g. `image/*`). Default value depends on the property type as shown in the table below. */
  contentType?: string;
  /** A map allowing additional information to be provided as headers. `Content-Type` is described separately and SHALL be ignored in this section. This field SHALL be ignored if the request body media type is not a `multipart`. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  style?: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  explode?: boolean;
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