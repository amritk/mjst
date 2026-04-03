import type { EncodingObject } from './encoding';
import type { ExampleObject } from './example';
import type { ExampleXORExamplesObject } from './example-xor-examples';
import type { ReferenceObject } from './reference';
import type { SchemaObject } from './schema';
export type MediaTypeObject = {
    schema?: SchemaObject | ReferenceObject;
    example?: unknown;
    examples?: Record<string, ExampleObject | ReferenceObject>;
    encoding?: Record<string, EncodingObject>;
} & ExampleXORExamplesObject;
