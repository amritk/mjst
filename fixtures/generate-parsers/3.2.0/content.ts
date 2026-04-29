import type { ReferenceObject } from './reference';
import { type MediaTypeObject, parseMediaTypeObject } from './media-type';
import { validateRecord } from '@amritk/helpers/validate-record';

export type ContentObject = {
  [key: string]: MediaTypeObject | ReferenceObject;
};

export const parseContentObject = (input: unknown): ContentObject => validateRecord(input, parseMediaTypeObject) as ContentObject;