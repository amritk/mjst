import type { OperationObject } from './operation';
import type { ParameterObject } from './parameter';
import type { ReferenceObject } from './reference';
import type { ServerObject } from './server';
export type PathItemObject = {
    $ref?: string;
    summary?: string;
    description?: string;
    get?: OperationObject;
    put?: OperationObject;
    post?: OperationObject;
    delete?: OperationObject;
    options?: OperationObject;
    head?: OperationObject;
    patch?: OperationObject;
    trace?: OperationObject;
    servers?: ServerObject[];
    parameters?: (ParameterObject | ReferenceObject)[];
};
