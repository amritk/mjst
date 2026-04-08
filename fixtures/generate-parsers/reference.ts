import { isObject } from 'mjst-helpers/is-object';

export type ReferenceObject = {
  $ref?: string;
  summary?: string;
  description?: string;
};

export const parseReferenceObject = (input: unknown): ReferenceObject => {
  if (!isObject(input)) return {};
  const _$ref = input.$ref;
  const _summary = input.summary;
  const _description = input.description;
  if ((_$ref === undefined || typeof _$ref === "string") && (_summary === undefined || typeof _summary === "string") && (_description === undefined || typeof _description === "string")) return input as ReferenceObject;
  return {
    ...input,
    ...(_$ref !== undefined && { $ref: typeof _$ref === "string" ? _$ref : String(_$ref) }),
    ...(_summary !== undefined && { summary: typeof _summary === "string" ? _summary : String(_summary) }),
    ...(_description !== undefined && { description: typeof _description === "string" ? _description : String(_description) }),
  };
}