export type CollectionFormatObject = "csv" | "ssv" | "tsv" | "pipes";

export const parseCollectionFormatObject = (input: unknown): CollectionFormatObject => typeof input === "string" ? input as CollectionFormatObject : "" as CollectionFormatObject;