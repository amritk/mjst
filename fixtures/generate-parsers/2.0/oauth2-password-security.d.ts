import type { Oauth2ScopesObject } from './oauth2-scopes';
export type Oauth2PasswordSecurityObject = {
    type: "oauth2";
    flow: "password";
    scopes?: Oauth2ScopesObject;
    tokenUrl: string;
    description?: string;
};
