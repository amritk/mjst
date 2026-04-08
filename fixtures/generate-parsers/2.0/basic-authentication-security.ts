import { isObject } from 'mjst-helpers/is-object';

/**
* Security Scheme object
*
* Allows the definition of a security scheme that can be used by the operations. Supported schemes are basic authentication, an API key (either as a header or as a query parameter) and OAuth2's common flows (implicit, password, application and access code).
* 
* @see {@link https://swagger.io/specification/v2/#security-scheme-object}
*/
export type BasicAuthenticationSecurityObject = {
  /** **Required.** The type of the security scheme. Valid values are `"basic"`, `"apiKey"` or `"oauth2"`. */
  type: "basic";
  /** A short description for security scheme. */
  description?: string;
};

export const parseBasicAuthenticationSecurityObject = (input: unknown): BasicAuthenticationSecurityObject => {
  if (!isObject(input)) {
    return {} as unknown as BasicAuthenticationSecurityObject;
  }
  const result = {
    ...input,
    type: typeof input?.type === "string" && ["basic"].includes(input?.type as never) ? input?.type : (input?.type !== undefined ? String(input?.type) : "basic"),
    ...((value => value === undefined ? {} : { description: value })(typeof input?.description === "string" ? input?.description : (input?.description !== undefined ? String(input?.description) : undefined))),
  } as unknown as BasicAuthenticationSecurityObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};