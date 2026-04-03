import type { CollectionFormatWithMultiObject } from './collection-format-with-multi';
import type { DefaultObject } from './default';
import type { EnumObject } from './enum';
import type { ExclusiveMaximumObject } from './exclusive-maximum';
import type { ExclusiveMinimumObject } from './exclusive-minimum';
import type { MaxItemsObject } from './max-items';
import type { MaxLengthObject } from './max-length';
import type { MaximumObject } from './maximum';
import type { MinItemsObject } from './min-items';
import type { MinLengthObject } from './min-length';
import type { MinimumObject } from './minimum';
import type { MultipleOfObject } from './multiple-of';
import type { PatternObject } from './pattern';
import type { PrimitivesItemsObject } from './primitives-items';
import type { UniqueItemsObject } from './unique-items';
import type { VendorExtensionObject } from './vendor-extension';

export type FormDataParameterSubSchemaObject = {
  /** Determines whether or not this parameter is required or optional. */
  required?: boolean;
  /** Determines the location of the parameter. */
  in?: "formData";
  /** A brief description of the parameter. This could contain examples of use.  GitHub Flavored Markdown is allowed. */
  description?: string;
  /** The name of the parameter. */
  name?: string;
  /** allows sending a parameter by name only or with an empty value. */
  allowEmptyValue?: boolean;
  type?: "string" | "number" | "boolean" | "integer" | "array" | "file";
  format?: string;
  items?: PrimitivesItemsObject;
  collectionFormat?: CollectionFormatWithMultiObject;
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