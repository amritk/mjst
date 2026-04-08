import { type ExternalDocsObject, parseExternalDocsObject } from './external-docs';
import { isObject } from 'mjst-helpers/is-object';

export type FileSchemaObject = {
  format?: string;
  title?: unknown;
  description?: unknown;
  default?: unknown;
  required?: unknown;
  type: "file";
  readOnly?: boolean;
  externalDocs?: ExternalDocsObject;
  example?: unknown;
};

export const parseFileSchemaObject = (input: unknown): FileSchemaObject => {
  if (!isObject(input)) {
    return {} as unknown as FileSchemaObject;
  }
  const result = {
    ...input,
    ...((value => value === undefined ? {} : { format: value })(typeof input?.format === "string" ? input?.format : (input?.format !== undefined ? String(input?.format) : undefined))),
    ...((value => value === undefined ? {} : { title: value })(input?.title ?? undefined)),
    ...((value => value === undefined ? {} : { description: value })(input?.description ?? undefined)),
    ...((value => value === undefined ? {} : { default: value })(input?.default ?? undefined)),
    ...((value => value === undefined ? {} : { required: value })(input?.required ?? undefined)),
    type: typeof input?.type === "string" && ["file"].includes(input?.type as never) ? input?.type : (input?.type !== undefined ? String(input?.type) : "file"),
    ...((value => value === undefined ? {} : { readOnly: value })(typeof input?.readOnly === "boolean" ? input?.readOnly : (input?.readOnly !== undefined ? Boolean(input?.readOnly) : undefined))),
    ...(input.externalDocs && { externalDocs: parseExternalDocsObject(input.externalDocs) }),
    ...((value => value === undefined ? {} : { example: value })(input?.example ?? undefined)),
  } as unknown as FileSchemaObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};