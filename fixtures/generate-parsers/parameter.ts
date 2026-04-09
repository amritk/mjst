import { type ContentObject, parseContentObject } from './content';
import { type SchemaObject, parseSchemaObject } from './schema';
import { isObject } from 'mjst-helpers/is-object';

export type ParameterObject = {
  in: "query";
  allowEmptyValue: boolean;
} & Record<`x-${string}`, unknown>;

export const parseParameterObject = (input: unknown): ParameterObject => {
  if (!isObject(input)) return {} as ParameterObject;
  const _schema = input.schema;
  const _content = input.content;
  return {
    ...input,
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    in: ["query","header","path","cookie"].includes(input?.in as never) ? input?.in : "query",
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
  } as unknown as ParameterObject;
}