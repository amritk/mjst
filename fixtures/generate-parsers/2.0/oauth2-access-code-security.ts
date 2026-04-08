import { type Oauth2ScopesObject, parseOauth2ScopesObject } from './oauth2-scopes';
import { isObject } from 'mjst-helpers/is-object';

/**
* Security Scheme object
*
* Allows the definition of a security scheme that can be used by the operations. Supported schemes are basic authentication, an API key (either as a header or as a query parameter) and OAuth2's common flows (implicit, password, application and access code).
* 
* @see {@link https://swagger.io/specification/v2/#security-scheme-object}
*/
export type Oauth2AccessCodeSecurityObject = {
  /** **Required.** The type of the security scheme. Valid values are `"basic"`, `"apiKey"` or `"oauth2"`. */
  type: "oauth2";
  /** **Required.** The flow used by the OAuth2 security scheme. Valid values are `"implicit"`, `"password"`, `"application"` or `"accessCode"`. */
  flow: "accessCode";
  /** **Required.** The available scopes for the OAuth2 security scheme. */
  scopes?: Oauth2ScopesObject;
  /** **Required.** The authorization URL to be used for this flow. This SHOULD be in the form of a URL. */
  authorizationUrl: string;
  /** **Required.** The token URL to be used for this flow. This SHOULD be in the form of a URL. */
  tokenUrl: string;
  /** A short description for security scheme. */
  description?: string;
};

export const parseOauth2AccessCodeSecurityObject = (input: unknown): Oauth2AccessCodeSecurityObject => {
  if (!isObject(input)) {
    return {} as unknown as Oauth2AccessCodeSecurityObject;
  }
  const result = {
    ...input,
    type: typeof input?.type === "string" && ["oauth2"].includes(input?.type as never) ? input?.type : (input?.type !== undefined ? String(input?.type) : "oauth2"),
    flow: typeof input?.flow === "string" && ["accessCode"].includes(input?.flow as never) ? input?.flow : (input?.flow !== undefined ? String(input?.flow) : "accessCode"),
    ...(input.scopes && { scopes: parseOauth2ScopesObject(input.scopes) }),
    authorizationUrl: typeof input?.authorizationUrl === "string" ? input?.authorizationUrl : (input?.authorizationUrl !== undefined ? String(input?.authorizationUrl) : ""),
    tokenUrl: typeof input?.tokenUrl === "string" ? input?.tokenUrl : (input?.tokenUrl !== undefined ? String(input?.tokenUrl) : ""),
    ...((value => value === undefined ? {} : { description: value })(typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : undefined))),
  } as unknown as Oauth2AccessCodeSecurityObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};