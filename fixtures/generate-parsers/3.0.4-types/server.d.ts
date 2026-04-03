import type { ServerVariableObject } from './server-variable';
export type ServerObject = {
    url: string;
    description?: string;
    variables?: Record<string, ServerVariableObject>;
};
