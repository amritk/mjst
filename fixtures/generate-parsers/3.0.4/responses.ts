import { type ReferenceObject, parseReferenceObject } from './reference';
import { type ResponseObject, parseResponseObject } from './response';
import { isObject } from 'mjst-helpers/is-object';

export type ResponsesObject = {
  default?: ResponseObject | ReferenceObject;
};

export const parseResponsesObject = (input: unknown): ResponsesObject => {
  if (!isObject(input)) return {} as ResponsesObject;
  return {
    ...input,
    ...(input.default !== undefined && { default: input?.default ?? undefined }),
  } as unknown as ResponsesObject;
}