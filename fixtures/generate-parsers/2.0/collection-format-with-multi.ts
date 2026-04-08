export type CollectionFormatWithMultiObject = "csv" | "ssv" | "tsv" | "pipes" | "multi";

export const parseCollectionFormatWithMultiObject = (input: unknown): CollectionFormatWithMultiObject => typeof input === "string" ? input as CollectionFormatWithMultiObject : "" as CollectionFormatWithMultiObject;