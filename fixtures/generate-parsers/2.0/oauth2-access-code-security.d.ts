import type { Oauth2ScopesObject } from './oauth2-scopes';
export type Oauth2AccessCodeSecurityObject = {
    type: "oauth2";
    flow: "accessCode";
    scopes?: Oauth2ScopesObject;
    authorizationUrl: string;
    tokenUrl: string;
    description?: string;
};
