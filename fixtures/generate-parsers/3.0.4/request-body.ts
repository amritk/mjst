import { type MediaTypeObject, parseMediaTypeObject } from './media-type';
import { validateRecord } from '@amritk/helpers/validate-record';
import { isObject } from '@amritk/helpers/is-object';

/**
* Request Body object
*
* Describes a single request body.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#request-body-object}
*/
export type RequestBodyObject = {
  /** A brief description of the request body. This could contain examples of use. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** **REQUIRED**. The content of the request body. The key is a media type or [media type range](https://tools.ietf.org/html/rfc7231#appendix-D) and the value describes it. For requests that match multiple keys, only the most specific key is applicable. e.g. `"text/plain"` overrides `"text/*"` */
  content: Record<string, MediaTypeObject>;
  /** Determines if the request body is required in the request. Defaults to `false`. */
  required?: boolean;
};

export const parseRequestBodyObject = (input: unknown): RequestBodyObject => {
  if (!isObject(input)) return {
        content: {},
      };
  const _content = input.content;
  return {
    ...input,
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    content: validateRecord(_content, parseMediaTypeObject),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
  } as unknown as RequestBodyObject;
}