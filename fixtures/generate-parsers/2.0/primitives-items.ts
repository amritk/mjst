import { type CollectionFormatObject, parseCollectionFormatObject } from './collection-format';
import { type DefaultObject, parseDefaultObject } from './default';
import { type EnumObject, parseEnumObject } from './enum';
import { type ExclusiveMaximumObject, parseExclusiveMaximumObject } from './exclusive-maximum';
import { type ExclusiveMinimumObject, parseExclusiveMinimumObject } from './exclusive-minimum';
import { type MaxItemsObject, parseMaxItemsObject } from './max-items';
import { type MaxLengthObject, parseMaxLengthObject } from './max-length';
import { type MaximumObject, parseMaximumObject } from './maximum';
import { type MinItemsObject, parseMinItemsObject } from './min-items';
import { type MinLengthObject, parseMinLengthObject } from './min-length';
import { type MinimumObject, parseMinimumObject } from './minimum';
import { type MultipleOfObject, parseMultipleOfObject } from './multiple-of';
import { type PatternObject, parsePatternObject } from './pattern';
import { type UniqueItemsObject, parseUniqueItemsObject } from './unique-items';
import { isObject } from 'mjst-helpers/is-object';

export type PrimitivesItemsObject = {
  type?: "string" | "number" | "integer" | "boolean" | "array";
  format?: string;
  items?: PrimitivesItemsObject;
  collectionFormat?: CollectionFormatObject;
  default?: DefaultObject;
  maximum?: MaximumObject;
  exclusiveMaximum?: ExclusiveMaximumObject;
  minimum?: MinimumObject;
  exclusiveMinimum?: ExclusiveMinimumObject;
  maxLength?: MaxLengthObject;
  minLength?: MinLengthObject;
  pattern?: PatternObject;
  maxItems?: MaxItemsObject;
  minItems?: MinItemsObject;
  uniqueItems?: UniqueItemsObject;
  enum?: EnumObject;
  multipleOf?: MultipleOfObject;
};

export const parsePrimitivesItemsObject = (input: unknown): PrimitivesItemsObject => {
  if (!isObject(input)) {
    return {} as unknown as PrimitivesItemsObject;
  }
  const result = {
    ...input,
    ...((value => value === undefined ? {} : { type: value })(typeof input?.type === "string" && ["string","number","integer","boolean","array"].includes(input?.type as never) ? input?.type : (input?.type !== undefined ? String(input?.type) : undefined))),
    ...((value => value === undefined ? {} : { format: value })(typeof input?.format === "string" ? input?.format : (input?.format !== undefined ? String(input?.format) : undefined))),
    ...(input.items && { items: parsePrimitivesItemsObject(input.items) }),
    ...(input.collectionFormat && { collectionFormat: parseCollectionFormatObject(input.collectionFormat) }),
    ...(input.default && { default: parseDefaultObject(input.default) }),
    ...(input.maximum && { maximum: parseMaximumObject(input.maximum) }),
    ...(input.exclusiveMaximum && { exclusiveMaximum: parseExclusiveMaximumObject(input.exclusiveMaximum) }),
    ...(input.minimum && { minimum: parseMinimumObject(input.minimum) }),
    ...(input.exclusiveMinimum && { exclusiveMinimum: parseExclusiveMinimumObject(input.exclusiveMinimum) }),
    ...(input.maxLength && { maxLength: parseMaxLengthObject(input.maxLength) }),
    ...(input.minLength && { minLength: parseMinLengthObject(input.minLength) }),
    ...(input.pattern && { pattern: parsePatternObject(input.pattern) }),
    ...(input.maxItems && { maxItems: parseMaxItemsObject(input.maxItems) }),
    ...(input.minItems && { minItems: parseMinItemsObject(input.minItems) }),
    ...(input.uniqueItems && { uniqueItems: parseUniqueItemsObject(input.uniqueItems) }),
    ...(input.enum && { enum: parseEnumObject(input.enum) }),
    ...(input.multipleOf && { multipleOf: parseMultipleOfObject(input.multipleOf) }),
  } as unknown as PrimitivesItemsObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};