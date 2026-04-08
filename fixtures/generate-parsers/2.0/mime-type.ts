export type MimeTypeObject = string;

export const parseMimeTypeObject = (input: unknown): MimeTypeObject => typeof input === "string" ? input as MimeTypeObject : "" as MimeTypeObject;