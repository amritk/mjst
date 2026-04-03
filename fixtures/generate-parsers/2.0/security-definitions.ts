import type { ApiKeySecurityObject } from './api-key-security';
import type { BasicAuthenticationSecurityObject } from './basic-authentication-security';
import type { Oauth2AccessCodeSecurityObject } from './oauth2-access-code-security';
import type { Oauth2ApplicationSecurityObject } from './oauth2-application-security';
import type { Oauth2ImplicitSecurityObject } from './oauth2-implicit-security';
import type { Oauth2PasswordSecurityObject } from './oauth2-password-security';

export type SecurityDefinitionsObject = {
  [key: string]: BasicAuthenticationSecurityObject | ApiKeySecurityObject | Oauth2ImplicitSecurityObject | Oauth2PasswordSecurityObject | Oauth2ApplicationSecurityObject | Oauth2AccessCodeSecurityObject;
};