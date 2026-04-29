import { isObject } from '@amritk/helpers/is-object';

/**
* Security Scheme object
*
* Defines a security scheme that can be used by the operations.  Supported schemes are HTTP authentication, an API key (either as a header, a cookie parameter, or as a query parameter), OAuth2's common flows (implicit, password, client credentials, and authorization code) as defined in [RFC6749](https://tools.ietf.org/html/rfc6749), and [[OpenID-Connect-Core]]. Please note that as of 2020, the implicit flow is about to be deprecated by [OAuth 2.0 Security Best Current Practice](https://tools.ietf.org/html/draft-ietf-oauth-security-topics). Recommended for most use cases is Authorization Code Grant flow with PKCE.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#security-scheme-object}
*/
export type ApiKeySecuritySchemeObject = {
  /** **REQUIRED**. The type of the security scheme. Valid values are `"apiKey"`, `"http"`, `"oauth2"`, `"openIdConnect"`. */
  type: "apiKey";
  /** **REQUIRED**. The name of the header, query or cookie parameter to be used. */
  name: string;
  /** **REQUIRED**. The location of the API key. Valid values are `"query"`, `"header"`, or `"cookie"`. */
  in: "header" | "query" | "cookie";
  /** A description for security scheme. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
};

export const parseApiKeySecuritySchemeObject = (input: unknown): ApiKeySecuritySchemeObject => {
  if (!isObject(input)) return {
        type: "apiKey",
        name: "",
        in: "header",
      };
  return {
    ...input,
    type: typeof input?.type === "string" && ["apiKey"].includes(input?.type as never) ? input?.type : (input?.type !== undefined ? String(input?.type) : "apiKey"),
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    in: typeof input?.in === "string" && ["header","query","cookie"].includes(input?.in as never) ? input?.in : (input?.in !== undefined ? String(input?.in) : "header"),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
  } as unknown as ApiKeySecuritySchemeObject;
}