import type { ReferenceObject } from './reference';
import { type ContentObject, parseContentObject } from './content';
import { type HeaderObject, parseHeaderObject } from './header';
import { type LinkObject, parseLinkObject } from './link';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

export type ResponseObject = {
  description: string;
  headers?: Record<string, HeaderObject | ReferenceObject>;
  content?: ContentObject;
  links?: Record<string, LinkObject | ReferenceObject>;
} & Record<`x-${string}`, unknown>;

export const parseResponseObject = (input: unknown): ResponseObject => {
  if (!isObject(input)) return {
        description: "",
      };
  const _headers = input.headers;
  const _content = input.content;
  const _links = input.links;
  return {
    ...input,
    description: typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : ""),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeaderObject) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
    ...(_links !== undefined && { links: validateRecord(_links, parseLinkObject) }),
  };
}