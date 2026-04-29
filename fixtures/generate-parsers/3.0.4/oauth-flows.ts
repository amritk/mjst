import { type AuthorizationCodeOauthFlowObject, parseAuthorizationCodeOauthFlowObject } from './authorization-code-oauth-flow';
import { type ClientCredentialsFlowObject, parseClientCredentialsFlowObject } from './client-credentials-flow';
import { type ImplicitOauthFlowObject, parseImplicitOauthFlowObject } from './implicit-oauth-flow';
import { type PasswordOauthFlowObject, parsePasswordOauthFlowObject } from './password-oauth-flow';
import { isObject } from '@amritk/helpers/is-object';

/**
* Oauth Flows object
*
* Allows configuration of the supported OAuth Flows.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#oauth-flows-object}
*/
export type OauthFlowsObject = {
  /** Configuration for the OAuth Implicit flow */
  implicit?: ImplicitOauthFlowObject;
  /** Configuration for the OAuth Resource Owner Password flow */
  password?: PasswordOauthFlowObject;
  /** Configuration for the OAuth Client Credentials flow. Previously called `application` in OpenAPI 2.0. */
  clientCredentials?: ClientCredentialsFlowObject;
  /** Configuration for the OAuth Authorization Code flow. Previously called `accessCode` in OpenAPI 2.0. */
  authorizationCode?: AuthorizationCodeOauthFlowObject;
};

export const parseOauthFlowsObject = (input: unknown): OauthFlowsObject => {
  if (!isObject(input)) return {} as OauthFlowsObject;
  const _implicit = input.implicit;
  const _password = input.password;
  const _clientCredentials = input.clientCredentials;
  const _authorizationCode = input.authorizationCode;
  return {
    ...input,
    ...(_implicit !== undefined && { implicit: parseImplicitOauthFlowObject(_implicit) }),
    ...(_password !== undefined && { password: parsePasswordOauthFlowObject(_password) }),
    ...(_clientCredentials !== undefined && { clientCredentials: parseClientCredentialsFlowObject(_clientCredentials) }),
    ...(_authorizationCode !== undefined && { authorizationCode: parseAuthorizationCodeOauthFlowObject(_authorizationCode) }),
  } as unknown as OauthFlowsObject;
}