import { type MimeTypeObject, parseMimeTypeObject } from './mime-type';

export type MediaTypeListObject = MimeTypeObject[];

export const parseMediaTypeListObject = (input: unknown): MediaTypeListObject => Array.isArray(input) ? input as MediaTypeListObject : [] as MediaTypeListObject;