import type { VendorExtensionObject } from './vendor-extension';

export type ApiKeySecurityObject = {
  type: "apiKey";
  name: string;
  in: "header" | "query";
  description?: string;
};