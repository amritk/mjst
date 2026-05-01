import { type OauthFlowsObject, parseOauthFlowsObject } from './oauth-flows';
import { isObject } from '@amritk/helpers/is-object';

/**
* Security Scheme object
*
* Defines a security scheme that can be used by the operations.  Supported schemes are HTTP authentication, an API key (either as a header, a cookie parameter or as a query parameter), mutual TLS (use of a client certificate), OAuth2's common flows (implicit, password, client credentials and authorization code) as defined in [RFC6749](https://tools.ietf.org/html/rfc6749), OAuth2 device authorization flow as defined in [RFC8628](https://tools.ietf.org/html/rfc8628), and [[OpenID-Connect-Core]]. Please note that as of 2020, the implicit flow is about to be deprecated by [OAuth 2.0 Security Best Current Practice](https://tools.ietf.org/html/draft-ietf-oauth-security-topics). Recommended for most use cases is Authorization Code Grant flow with PKCE.
* 
* @see {@link https://spec.openapis.org/oas/v3.2#security-scheme-object}
*/
export type TypeOauth2Object = {
  /** **REQUIRED**. The type of the security scheme. Valid values are `"apiKey"`, `"http"`, `"mutualTLS"`, `"oauth2"`, `"openIdConnect"`. */
  type: "oauth2";
  /** **REQUIRED**. An object containing configuration information for the flow types supported. */
  flows: OauthFlowsObject;
  /** URL to the OAuth2 authorization server metadata [RFC8414](https://datatracker.ietf.org/doc/html/rfc8414). TLS is required. */
  oauth2MetadataUrl: string;
};

export const parseTypeOauth2Object = (input: unknown): TypeOauth2Object => {
  if (!isObject(input)) return {} as TypeOauth2Object;
  const _flows = input.flows;
  return {
    ...input,
    type: input?.type === "oauth2" ? input?.type : "oauth2",
    flows: parseOauthFlowsObject(_flows),
    ...(input.oauth2MetadataUrl !== undefined && { oauth2MetadataUrl: typeof input?.oauth2MetadataUrl === "string" ? input?.oauth2MetadataUrl : String(input?.oauth2MetadataUrl) }),
  } as unknown as TypeOauth2Object;
}