import { isObject } from 'mjst-helpers/is-object';

/**
* Oauth Flow object
*
* Configuration details for a supported OAuth Flow
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#oauth-flow-object}
*/
export type PasswordOauthFlowObject = {
  /** **REQUIRED**. The token URL to be used for this flow. This MUST be in the form of a URL. The OAuth2 standard requires the use of TLS. */
  tokenUrl: string;
  /** The URL to be used for obtaining refresh tokens. This MUST be in the form of a URL. The OAuth2 standard requires the use of TLS. */
  refreshUrl?: string;
  /** **REQUIRED**. The available scopes for the OAuth2 security scheme. A map between the scope name and a short description for it. The map MAY be empty. */
  scopes: Record<string, string>;
};

export const parsePasswordOauthFlowObject = (input: unknown): PasswordOauthFlowObject => {
  if (!isObject(input)) return {
        tokenUrl: "",
        scopes: {},
      };
  const _tokenUrl = input.tokenUrl;
  const _refreshUrl = input.refreshUrl;
  const _scopes = input.scopes;
  if (typeof _tokenUrl === "string" && (_refreshUrl === undefined || typeof _refreshUrl === "string") && isObject(_scopes)) return input as PasswordOauthFlowObject;
  return {
    ...input,
    tokenUrl: typeof _tokenUrl === "string" ? _tokenUrl : (_tokenUrl !== undefined ? String(_tokenUrl) : ""),
    ...(_refreshUrl !== undefined && { refreshUrl: typeof _refreshUrl === "string" ? _refreshUrl : String(_refreshUrl) }),
    scopes: isObject(_scopes) ? _scopes : (_scopes !== undefined ? typeof _scopes === "object" && _scopes !== null ? _scopes : {} : {}),
  } as unknown as PasswordOauthFlowObject;
}