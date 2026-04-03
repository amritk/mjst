import type { VendorExtensionObject } from './vendor-extension';

export type XmlObject = {
  name?: string;
  namespace?: string;
  prefix?: string;
  attribute?: boolean;
  wrapped?: boolean;
};