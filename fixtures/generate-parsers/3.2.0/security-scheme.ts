import { type TypeApikeyObject, parseTypeApikeyObject } from './type-apikey';
import { type TypeHttpBearerObject, parseTypeHttpBearerObject } from './type-http-bearer';
import { type TypeHttpObject, parseTypeHttpObject } from './type-http';
import { type TypeOauth2Object, parseTypeOauth2Object } from './type-oauth2';
import { type TypeOidcObject, parseTypeOidcObject } from './type-oidc';
import { isObject } from '@amritk/helpers/is-object';

/**
* Security Scheme object
*
* Defines a security scheme that can be used by the operations.  Supported schemes are HTTP authentication, an API key (either as a header, a cookie parameter or as a query parameter), mutual TLS (use of a client certificate), OAuth2's common flows (implicit, password, client credentials and authorization code) as defined in [RFC6749](https://tools.ietf.org/html/rfc6749), OAuth2 device authorization flow as defined in [RFC8628](https://tools.ietf.org/html/rfc8628), and [[OpenID-Connect-Core]]. Please note that as of 2020, the implicit flow is about to be deprecated by [OAuth 2.0 Security Best Current Practice](https://tools.ietf.org/html/draft-ietf-oauth-security-topics). Recommended for most use cases is Authorization Code Grant flow with PKCE.
* 
* @see {@link https://spec.openapis.org/oas/v3.2#security-scheme-object}
*/
export type SecuritySchemeObject = TypeApikeyObject | TypeHttpObject | TypeHttpBearerObject | TypeOauth2Object | TypeOidcObject;

export const parseSecuritySchemeObject = (input: unknown): SecuritySchemeObject => {
  if (!isObject(input)) {
    return parseTypeApikeyObject(input);
  }

  const parsedSubtype: SecuritySchemeObject = (() => {
    switch (input["type"]) {
    case "apiKey":
      return parseTypeApikeyObject(input);
    case "http":
      if (typeof input["scheme"] === "string" && /^[Bb][Ee][Aa][Rr][Ee][Rr]$/.test(input["scheme"])) {
        return parseTypeHttpBearerObject(input);
      }
      return parseTypeHttpObject(input);
    case "oauth2":
      return parseTypeOauth2Object(input);
    case "openIdConnect":
      return parseTypeOidcObject(input);
    default:
      return parseTypeApikeyObject(input);
    }
  })();

  return {
    ...input,
    ...((value => value === undefined ? {} : { description: value })(typeof input?.["description"] === "string" ? input?.["description"] : (input?.["description"] !== undefined ? String(input?.["description"]) : undefined))),
    ...parsedSubtype,
  };
};