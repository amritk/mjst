import type { ExternalDocsObject } from './external-docs';
import type { VendorExtensionObject } from './vendor-extension';

export type TagObject = {
  name: string;
  description?: string;
  externalDocs?: ExternalDocsObject;
};