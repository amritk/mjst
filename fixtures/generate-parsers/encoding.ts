import type { ReferenceObject } from './reference';
import { type HeaderObject, parseHeaderObject } from './header';
import { type StylesForFormObject, parseStylesForFormObject } from './styles-for-form';
import { validateRecord } from 'mjst-helpers/validate-record';
import { isObject } from 'mjst-helpers/is-object';

export type EncodingObject = {
  contentType?: string;
  headers?: Record<string, HeaderObject | ReferenceObject>;
  style?: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  explode?: boolean;
  allowReserved?: boolean;
} & StylesForFormObject;

export const parseEncodingObject = (input: unknown): EncodingObject => {
  if (!isObject(input)) return {};
  const _headers = input.headers;
  return {
    ...input,
    ...parseStylesForFormObject(input),
    ...(input.contentType !== undefined && { contentType: typeof input?.contentType === "string" ? input?.contentType : String(input?.contentType) }),
    ...(_headers !== undefined && { headers: validateRecord(_headers, parseHeaderObject) }),
    ...(input.style !== undefined && { style: ["form","spaceDelimited","pipeDelimited","deepObject"].includes(input?.style) ? input?.style : "form" }),
    ...(input.explode !== undefined && { explode: typeof input?.explode === "boolean" ? input?.explode : Boolean(input?.explode) }),
    ...(input.allowReserved !== undefined && { allowReserved: typeof input?.allowReserved === "boolean" ? input?.allowReserved : Boolean(input?.allowReserved) }),
  };
}