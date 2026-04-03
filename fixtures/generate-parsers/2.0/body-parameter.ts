import type { SchemaObject } from './schema';
import type { VendorExtensionObject } from './vendor-extension';

export type BodyParameterObject = {
  /** A brief description of the parameter. This could contain examples of use.  GitHub Flavored Markdown is allowed. */
  description?: string;
  /** The name of the parameter. */
  name: string;
  /** Determines the location of the parameter. */
  in: "body";
  /** Determines whether or not this parameter is required or optional. */
  required?: boolean;
  schema: SchemaObject;
};