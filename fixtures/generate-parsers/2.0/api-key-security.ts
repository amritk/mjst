import { isObject } from 'mjst-helpers/is-object';

/**
* Security Scheme object
*
* Allows the definition of a security scheme that can be used by the operations. Supported schemes are basic authentication, an API key (either as a header or as a query parameter) and OAuth2's common flows (implicit, password, application and access code).
* 
* @see {@link https://swagger.io/specification/v2/#security-scheme-object}
*/
export type ApiKeySecurityObject = {
  /** **Required.** The type of the security scheme. Valid values are `"basic"`, `"apiKey"` or `"oauth2"`. */
  type: "apiKey";
  /** **Required.** The name of the header or query parameter to be used. */
  name: string;
  /** **Required** The location of the API key. Valid values are `"query"` or `"header"`. */
  in: "header" | "query";
  /** A short description for security scheme. */
  description?: string;
};

export const parseApiKeySecurityObject = (input: unknown): ApiKeySecurityObject => {
  if (!isObject(input)) {
    return {} as unknown as ApiKeySecurityObject;
  }
  const result = {
    ...input,
    type: typeof input?.type === "string" && ["apiKey"].includes(input?.type as never) ? input?.type : (input?.type !== undefined ? String(input?.type) : "apiKey"),
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    in: typeof input?.in === "string" && ["header","query"].includes(input?.in as never) ? input?.in : (input?.in !== undefined ? String(input?.in) : "header"),
    ...((value => value === undefined ? {} : { description: value })(typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : undefined))),
  } as unknown as ApiKeySecurityObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};