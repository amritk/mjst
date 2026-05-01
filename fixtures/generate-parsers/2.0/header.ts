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
import { type PrimitivesItemsObject, parsePrimitivesItemsObject } from './primitives-items';
import { type UniqueItemsObject, parseUniqueItemsObject } from './unique-items';
import { isObject } from '@amritk/helpers/is-object';

/**
* Header object
*
* Field Name | Type | Description ---|:---:|--- <a name="headerDescription"></a>description | `string` | A short description of the header. <a name="headerType"></a>type | `string` | **Required.** The type of the object. The value MUST be one of `"string"`, `"number"`, `"integer"`, `"boolean"`, or `"array"`. <a name="headerFormat"></a>format | `string` | The extending format for the previously mentioned [`type`](#stType). See [Data Type Formats](#dataTypeFormat) for further details. <a name="headerItems"></a>items | [Items Object](#items-object) | **Required if [`type`](#stType) is "array".** Describes the type of items in the array. <a name="headerCollectionFormat"></a>collectionFormat | `string` | Determines the format of the array if type array is used. Possible values are: <ul><li>`csv` - comma separated values `foo,bar`. <li>`ssv` - space separated values `foo bar`. <li>`tsv` - tab separated values `foo\tbar`. <li>`pipes` - pipe separated values <code>foo&#124;bar</code>. </ul> Default value is `csv`. <a name="headerDefault"></a>default | * | Declares the value of the header that the server will use if none is provided. (Note: "default" has no meaning for required headers.) See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-6.2. Unlike JSON Schema this value MUST conform to the defined [`type`](#headerDefault) for the header. <a name="headerMaximum"></a>maximum | `number` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.2. <a name="headerMaximum"></a>exclusiveMaximum | `boolean` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.2. <a name="headerMinimum"></a>minimum | `number` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.3. <a name="headerExclusiveMinimum"></a>exclusiveMinimum | `boolean` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.3. <a name="headerMaxLength"></a>maxLength | `integer` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.2.1. <a name="headerMinLength"></a>minLength | `integer` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.2.2. <a name="headerPattern"></a>pattern | `string` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.2.3. <a name="headerMaxItems"></a>maxItems | `integer` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.3.2. <a name="headerMinItems"></a>minItems | `integer` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.3.3. <a name="headerUniqueItems"></a>uniqueItems | `boolean` | https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.3.4. <a name="headerEnum"></a>enum | [*] | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.5.1. <a name="headerMultipleOf"></a>multipleOf | `number` | See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.1.
* 
* @see {@link https://swagger.io/specification/v2/#header-object}
*/
export type HeaderObject = {
  /** **Required.** The type of the parameter. Since the parameter is not located at the request body, it is limited to simple types (that is, not an object). The value MUST be one of `"string"`, `"number"`, `"integer"`, `"boolean"`, `"array"` or `"file"`. If `type` is `"file"`, the [`consumes`](https://swagger.io/specification/v2/#operationConsumes) MUST be either `"multipart/form-data"`, `" application/x-www-form-urlencoded"` or both and the parameter MUST be [`in`](https://swagger.io/specification/v2/#parameterIn) `"formData"`. */
  type: "string" | "number" | "integer" | "boolean" | "array";
  /** The extending format for the previously mentioned [`type`](https://swagger.io/specification/v2/#parameterType). See [Data Type Formats](https://swagger.io/specification/v2/#dataTypeFormat) for further details. */
  format?: string;
  /** **Required if [`type`](https://swagger.io/specification/v2/#parameterType) is "array".** Describes the type of items in the array. */
  items?: PrimitivesItemsObject;
  /** Determines the format of the array if type array is used. Possible values are: <ul><li>`csv` - comma separated values `foo,bar`. <li>`ssv` - space separated values `foo bar`. <li>`tsv` - tab separated values `foo\tbar`. <li>`pipes` - pipe separated values <code>foo&#124;bar</code>. <li>`multi` - corresponds to multiple parameter instances instead of multiple values for a single instance `foo=bar&foo=baz`. This is valid only for parameters [`in`](https://swagger.io/specification/v2/#parameterIn) "query" or "formData". </ul> Default value is `csv`. */
  collectionFormat?: CollectionFormatObject;
  /** Declares the value of the parameter that the server will use if none is provided, for example a "count" to control the number of results per page might default to 100 if not supplied by the client in the request. (Note: "default" has no meaning for required parameters.)  See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-6.2. Unlike JSON Schema this value MUST conform to the defined [`type`](https://swagger.io/specification/v2/#parameterType) for this parameter. */
  default?: DefaultObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.2. */
  maximum?: MaximumObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.2. */
  exclusiveMaximum?: ExclusiveMaximumObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.3. */
  minimum?: MinimumObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.3. */
  exclusiveMinimum?: ExclusiveMinimumObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.2.1. */
  maxLength?: MaxLengthObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.2.2. */
  minLength?: MinLengthObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.2.3. */
  pattern?: PatternObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.3.2. */
  maxItems?: MaxItemsObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.3.3. */
  minItems?: MinItemsObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.3.4. */
  uniqueItems?: UniqueItemsObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.5.1. */
  enum?: EnumObject;
  /** See https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.1.1. */
  multipleOf?: MultipleOfObject;
  /** A brief description of the parameter. This could contain examples of use.  [GFM syntax](https://guides.github.com/features/mastering-markdown/#GitHub-flavored-markdown) can be used for rich text representation. */
  description?: string;
};

export const parseHeaderObject = (input: unknown): HeaderObject => {
  if (!isObject(input)) {
    return {} as unknown as HeaderObject;
  }
  const result = {
    ...input,
    type: typeof input?.type === "string" && ["string","number","integer","boolean","array"].includes(input?.type as never) ? input?.type : (input?.type !== undefined ? String(input?.type) : "string"),
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
    ...((value => value === undefined ? {} : { description: value })(typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : undefined))),
  } as unknown as HeaderObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};