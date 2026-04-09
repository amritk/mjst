import { type ContentObject, parseContentObject } from './content';
import { isObject } from 'mjst-helpers/is-object';

export type RequestBodyObject = {
  description?: string;
  content: ContentObject;
  required?: boolean;
} & Record<`x-${string}`, unknown>;

export const parseRequestBodyObject = (input: unknown): RequestBodyObject => {
  if (!isObject(input)) return {
        content: parseContentObject(undefined),
      };
  const _content = input.content;
  return {
    ...input,
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    content: parseContentObject(_content),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
  } as unknown as RequestBodyObject;
}