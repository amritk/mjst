import { isObject } from '@amritk/helpers/is-object';

export type MetadataObject = {
  tags: string[];
  notes?: string;
};

export const validateMetadataObjectShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return Array.isArray(input.tags)
    && (input.notes === undefined || typeof input.notes === "string");
};

export const parseMetadataObject = (input: unknown): MetadataObject => {
  if (!isObject(input)) return {
        tags: [],
      };
  const _tags = input.tags;
  const _notes = input.notes;
  if (Array.isArray(_tags) && (_notes === undefined || typeof _notes === "string")) return { ...input } as MetadataObject;
  return {
    ...input,
    tags: Array.isArray(_tags) ? _tags : (_tags !== undefined ? [] : []),
    ...(_notes !== undefined && { notes: typeof _notes === "string" ? _notes : String(_notes) }),
  } as unknown as MetadataObject;
}