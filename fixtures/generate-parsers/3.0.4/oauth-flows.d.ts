import type { AuthorizationCodeOAuthFlowObject } from './authorization-code-oauth-flow';
import type { ClientCredentialsFlowObject } from './client-credentials-flow';
import type { ImplicitOAuthFlowObject } from './implicit-oauth-flow';
import type { PasswordOAuthFlowObject } from './password-oauth-flow';
/**
* Oauth Flows object
*
* Allows configuration of the supported OAuth Flows.
*
* @see {@link https://spec.openapis.org/oas/v3.0.4#oauth-flows-object}
*/
export type OAuthFlowsObject = {
    /** Configuration for the OAuth Implicit flow */
    implicit?: ImplicitOAuthFlowObject;
    /** Configuration for the OAuth Resource Owner Password flow */
    password?: PasswordOAuthFlowObject;
    /** Configuration for the OAuth Client Credentials flow. Previously called `application` in OpenAPI 2.0. */
    clientCredentials?: ClientCredentialsFlowObject;
    /** Configuration for the OAuth Authorization Code flow. Previously called `accessCode` in OpenAPI 2.0. */
    authorizationCode?: AuthorizationCodeOAuthFlowObject;
};
