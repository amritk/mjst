import { type ApiKeySecurityObject, parseApiKeySecurityObject } from './api-key-security';
import { type BasicAuthenticationSecurityObject, parseBasicAuthenticationSecurityObject } from './basic-authentication-security';
import { type Oauth2AccessCodeSecurityObject, parseOauth2AccessCodeSecurityObject } from './oauth2-access-code-security';
import { type Oauth2ApplicationSecurityObject, parseOauth2ApplicationSecurityObject } from './oauth2-application-security';
import { type Oauth2ImplicitSecurityObject, parseOauth2ImplicitSecurityObject } from './oauth2-implicit-security';
import { type Oauth2PasswordSecurityObject, parseOauth2PasswordSecurityObject } from './oauth2-password-security';
import { isObject } from 'mjst-helpers/is-object';

/**
* Security Definitions object
*
* A declaration of the security schemes available to be used in the specification. This does not enforce the security schemes on the operations and only serves to provide the relevant details for each scheme.
* 
* @see {@link https://swagger.io/specification/v2/#security-definitions-object}
*/
export type SecurityDefinitionsObject = {
  [key: string]: BasicAuthenticationSecurityObject | ApiKeySecurityObject | Oauth2ImplicitSecurityObject | Oauth2PasswordSecurityObject | Oauth2ApplicationSecurityObject | Oauth2AccessCodeSecurityObject;
};

export const parseSecurityDefinitionsObject = (input: unknown): SecurityDefinitionsObject => isObject(input) ? input as SecurityDefinitionsObject : {};