export type SchemaXorContentObject = unknown | unknown & unknown & unknown & unknown & unknown;

export const parseSchemaXorContentObject = (input: unknown): SchemaXorContentObject => input as SchemaXorContentObject;