import { type JsonReferenceObject, parseJsonReferenceObject } from './json-reference';
import { type ParameterObject, parseParameterObject } from './parameter';

export type ParametersListObject = (ParameterObject | JsonReferenceObject)[];

export const parseParametersListObject = (input: unknown): ParametersListObject => Array.isArray(input) ? [...input] as ParametersListObject : [] as ParametersListObject;