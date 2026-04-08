import { type MediaTypeObject, parseMediaTypeObject } from './media-type';
import { validateRecord } from 'mjst-helpers/validate-record';

export type ContentObject = {
  [key: string]: MediaTypeObject;
};

export const parseContentObject = (input: unknown): ContentObject => validateRecord(input, parseMediaTypeObject) as ContentObject;