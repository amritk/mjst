import type { ServerObject } from './server';
export type LinkObject = {
    operationId?: string;
    operationRef?: string;
    parameters?: Record<string, unknown>;
    requestBody?: unknown;
    description?: string;
    server?: ServerObject;
};
