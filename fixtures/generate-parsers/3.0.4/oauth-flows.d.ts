import type { AuthorizationCodeOAuthFlowObject } from './authorization-code-oauth-flow';
import type { ClientCredentialsFlowObject } from './client-credentials-flow';
import type { ImplicitOAuthFlowObject } from './implicit-oauth-flow';
import type { PasswordOAuthFlowObject } from './password-oauth-flow';
export type OAuthFlowsObject = {
    implicit?: ImplicitOAuthFlowObject;
    password?: PasswordOAuthFlowObject;
    clientCredentials?: ClientCredentialsFlowObject;
    authorizationCode?: AuthorizationCodeOAuthFlowObject;
};
