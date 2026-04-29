import { type ParameterObject, parseParameterObject } from './parameter';
import { validateRecord } from '@amritk/helpers/validate-record';

/**
* Parameters Definitions object
*
* An object to hold parameters to be reused across operations. Parameter definitions can be referenced to the ones defined here.  This does *not* define global operation parameters.
* 
* @see {@link https://swagger.io/specification/v2/#parameters-definitions-object}
*/
export type ParameterDefinitionsObject = {
  [key: string]: ParameterObject;
};

export const parseParameterDefinitionsObject = (input: unknown): ParameterDefinitionsObject => validateRecord(input, parseParameterObject) as ParameterDefinitionsObject;