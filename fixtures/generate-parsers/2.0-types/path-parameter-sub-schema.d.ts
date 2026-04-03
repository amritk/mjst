import type { CollectionFormatObject } from './collection-format';
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
export type PathParameterSubSchemaObject = {
    /** Determines whether or not this parameter is required or optional. */
    required: true;
    /** Determines the location of the parameter. */
    in?: "path";
    /** A brief description of the parameter. This could contain examples of use.  GitHub Flavored Markdown is allowed. */
    description?: string;
    /** The name of the parameter. */
    name?: string;
    type?: "string" | "number" | "boolean" | "integer" | "array";
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
