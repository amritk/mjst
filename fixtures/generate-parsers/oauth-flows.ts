import { type AuthorizationCodeObject, parseAuthorizationCodeObject } from './authorization-code';
import { type ClientCredentialsObject, parseClientCredentialsObject } from './client-credentials';
import { type ImplicitObject, parseImplicitObject } from './implicit';
import { type PasswordObject, parsePasswordObject } from './password';
import { isObject } from 'mjst-helpers/is-object';

export type OauthFlowsObject = {
  implicit?: ImplicitObject;
  password?: PasswordObject;
  clientCredentials?: ClientCredentialsObject;
  authorizationCode?: AuthorizationCodeObject;
} & Record<`x-${string}`, unknown>;

export const parseOauthFlowsObject = (input: unknown): OauthFlowsObject => {
  if (!isObject(input)) return {} as OauthFlowsObject;
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
  } as unknown as OauthFlowsObject;
}