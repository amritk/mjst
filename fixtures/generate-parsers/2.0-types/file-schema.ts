import type { DefaultObject } from './default';
import type { DescriptionObject } from './description';
import type { ExternalDocsObject } from './external-docs';
import type { StringArrayObject } from './string-array';
import type { TitleObject } from './title';
import type { VendorExtensionObject } from './vendor-extension';

export type FileSchemaObject = {
  format?: string;
  title?: TitleObject;
  description?: DescriptionObject;
  default?: DefaultObject;
  required?: StringArrayObject;
  type: "file";
  readOnly?: boolean;
  externalDocs?: ExternalDocsObject;
  example?: unknown;
};