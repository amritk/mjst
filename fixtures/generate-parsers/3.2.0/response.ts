import type { ReferenceObject } from './reference';
import { type ContentObject, parseContentObject } from './content';
import { type HeaderObject, parseHeaderObject } from './header';
import { type LinkObject, parseLinkObject } from './link';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

/**
* Response object
*
* Describes a single response from an API operation, including design-time, static `links` to operations based on the response.
* 
* @see {@link https://spec.openapis.org/oas/v3.2#response-object}
*/
export type ResponseObject = {
  /** A short summary of the meaning of the response. */
  summary?: string;
  /** A description of the response. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** Maps a header name to its definition. [RFC9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1) states header names are case-insensitive. If a response header is defined with the name `"Content-Type"`, it SHALL be ignored. */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** A map containing descriptions of potential response payloads. The key is a media type or [media type range](https://www.rfc-editor.org/rfc/rfc9110.html#appendix-A) and the value describes it. For responses that match multiple keys, only the most specific key is applicable. e.g. `"text/plain"` overrides `"text/*"` */
  content?: ContentObject;
  /** A map of operations links that can be followed from the response. The key of the map is a short name for the link, following the naming constraints of the names for [Component Objects](https://spec.openapis.org/oas/v3.2#components-object). */
  links?: Record<string, LinkObject | ReferenceObject>;
} & Record<`x-${string}`, unknown>;

export const parseResponseObject = (input: unknown): ResponseObject => {
  if (!isObject(input)) return {} as ResponseObject;
  const _headers = input.headers;
  const _content = input.content;
  const _links = input.links;
  return {
    ...input,
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeaderObject) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
    ...(_links !== undefined && { links: validateRecord(_links, parseLinkObject) }),
  } as unknown as ResponseObject;
}