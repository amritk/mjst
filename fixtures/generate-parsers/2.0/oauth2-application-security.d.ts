import type { Oauth2ScopesObject } from './oauth2-scopes';
export type Oauth2ApplicationSecurityObject = {
    type: "oauth2";
    flow: "application";
    scopes?: Oauth2ScopesObject;
    tokenUrl: string;
    description?: string;
};
