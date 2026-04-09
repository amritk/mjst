import { type ContentObject, parseContentObject } from './content';
import { type SchemaObject, parseSchemaObject } from './schema';
import { isObject } from 'mjst-helpers/is-object';

export type HeaderObject = {
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: SchemaObject;
  content?: ContentObject;
} & Record<`x-${string}`, unknown>;

export const parseHeaderObject = (input: unknown): HeaderObject => {
  if (!isObject(input)) return {} as HeaderObject;
  const _schema = input.schema;
  const _content = input.content;
  return {
    ...input,
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.required !== undefined && { required: typeof input?.required === "boolean" ? input?.required : Boolean(input?.required) }),
    ...(input.deprecated !== undefined && { deprecated: typeof input?.deprecated === "boolean" ? input?.deprecated : Boolean(input?.deprecated) }),
    ...(_schema !== undefined && { schema: parseSchemaObject(_schema) }),
    ...(_content !== undefined && { content: parseContentObject(_content) }),
  } as unknown as HeaderObject;
}