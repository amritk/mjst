import type { ReferenceObject } from './reference';
import { type ParameterObject, parseParameterObject } from './parameter';

export type ParametersObject = (ParameterObject | ReferenceObject)[];

export const parseParametersObject = (input: unknown): ParametersObject => Array.isArray(input) ? [...input] as ParametersObject : [] as ParametersObject;