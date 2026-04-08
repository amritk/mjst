import { validateRecord } from 'mjst-helpers/validate-record';

/**
* Scopes object
*
* Lists the available scopes for an OAuth2 security scheme.
* 
* @see {@link https://swagger.io/specification/v2/#scopes-object}
*/
export type Oauth2ScopesObject = {
  [key: string]: string;
};

export const parseOauth2ScopesObject = (input: unknown): Oauth2ScopesObject => validateRecord(input, (value: unknown) => typeof value === "string" ? value : "") as Oauth2ScopesObject;