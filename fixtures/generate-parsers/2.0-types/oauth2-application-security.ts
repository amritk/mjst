import type { Oauth2ScopesObject } from './oauth2-scopes';
import type { VendorExtensionObject } from './vendor-extension';

export type Oauth2ApplicationSecurityObject = {
  type: "oauth2";
  flow: "application";
  scopes?: Oauth2ScopesObject;
  tokenUrl: string;
  description?: string;
};