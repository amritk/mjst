import { type MapOfStringsObject, parseMapOfStringsObject } from './map-of-strings';
import { isObject } from 'mjst-helpers/is-object';

/**
* Oauth Flow object
*
* Configuration details for a supported OAuth Flow
* 
* @see {@link https://spec.openapis.org/oas/v3.1#oauth-flow-object}
*/
export type ClientCredentialsObject = {
  /** **REQUIRED**. The token URL to be used for this flow. This MUST be in the form of a URL. The OAuth2 standard requires the use of TLS. */
  tokenUrl: string;
  /** The URL to be used for obtaining refresh tokens. This MUST be in the form of a URL. The OAuth2 standard requires the use of TLS. */
  refreshUrl?: string;
  /** **REQUIRED**. The available scopes for the OAuth2 security scheme. A map between the scope name and a short description for it. The map MAY be empty. */
  scopes: MapOfStringsObject;
} & Record<`x-${string}`, unknown>;

export const parseClientCredentialsObject = (input: unknown): ClientCredentialsObject => {
  if (!isObject(input)) return {
        tokenUrl: "",
        scopes: parseMapOfStringsObject(undefined),
      };
  const _scopes = input.scopes;
  return {
    ...input,
    tokenUrl: typeof input?.tokenUrl === "string" ? input?.tokenUrl : (input?.tokenUrl !== undefined ? String(input?.tokenUrl) : ""),
    ...(input.refreshUrl !== undefined && { refreshUrl: typeof input?.refreshUrl === "string" ? input?.refreshUrl : String(input?.refreshUrl) }),
    scopes: parseMapOfStringsObject(_scopes),
  } as unknown as ClientCredentialsObject;
}