import type { Oauth2ScopesObject } from './oauth2-scopes';
import type { VendorExtensionObject } from './vendor-extension';

export type Oauth2ImplicitSecurityObject = {
  type: "oauth2";
  flow: "implicit";
  scopes?: Oauth2ScopesObject;
  authorizationUrl: string;
  description?: string;
};