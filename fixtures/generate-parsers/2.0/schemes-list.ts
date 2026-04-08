export type SchemesListObject = ("http" | "https" | "ws" | "wss")[];

export const parseSchemesListObject = (input: unknown): SchemesListObject => Array.isArray(input) ? input as SchemesListObject : [] as SchemesListObject;