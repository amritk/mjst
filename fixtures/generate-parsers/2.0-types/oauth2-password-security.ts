import type { Oauth2ScopesObject } from './oauth2-scopes';
import type { VendorExtensionObject } from './vendor-extension';

export type Oauth2PasswordSecurityObject = {
  type: "oauth2";
  flow: "password";
  scopes?: Oauth2ScopesObject;
  tokenUrl: string;
  description?: string;
};