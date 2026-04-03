import type { ExamplesObject } from './examples';
import type { FileSchemaObject } from './file-schema';
import type { HeadersObject } from './headers';
import type { SchemaObject } from './schema';
import type { VendorExtensionObject } from './vendor-extension';

export type ResponseObject = {
  description: string;
  schema?: SchemaObject | FileSchemaObject;
  headers?: HeadersObject;
  examples?: ExamplesObject;
};