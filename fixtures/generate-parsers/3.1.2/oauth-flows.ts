import { type AuthorizationCodeObject, parseAuthorizationCodeObject } from './authorization-code';
import { type ClientCredentialsObject, parseClientCredentialsObject } from './client-credentials';
import { type ImplicitObject, parseImplicitObject } from './implicit';
import { type PasswordObject, parsePasswordObject } from './password';
import { isObject } from 'mjst-helpers/is-object';

/**
* Oauth Flows object
*
* Allows configuration of the supported OAuth Flows.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#oauth-flows-object}
*/
export type OauthFlowsObject = {
  /** Configuration for the OAuth Implicit flow */
  implicit?: ImplicitObject;
  /** Configuration for the OAuth Resource Owner Password flow */
  password?: PasswordObject;
  /** Configuration for the OAuth Client Credentials flow. Previously called `application` in OpenAPI 2.0. */
  clientCredentials?: ClientCredentialsObject;
  /** Configuration for the OAuth Authorization Code flow. Previously called `accessCode` in OpenAPI 2.0. */
  authorizationCode?: AuthorizationCodeObject;
} & Record<`x-${string}`, unknown>;

export const parseOauthFlowsObject = (input: unknown): OauthFlowsObject => {
  if (!isObject(input)) return {};
  const _implicit = input.implicit;
  const _password = input.password;
  const _clientCredentials = input.clientCredentials;
  const _authorizationCode = input.authorizationCode;
  return {
    ...input,
    ...(_implicit !== undefined && { implicit: parseImplicitObject(_implicit) }),
    ...(_password !== undefined && { password: parsePasswordObject(_password) }),
    ...(_clientCredentials !== undefined && { clientCredentials: parseClientCredentialsObject(_clientCredentials) }),
    ...(_authorizationCode !== undefined && { authorizationCode: parseAuthorizationCodeObject(_authorizationCode) }),
  };
}