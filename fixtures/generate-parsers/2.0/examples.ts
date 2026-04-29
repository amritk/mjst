import { isObject } from '@amritk/helpers/is-object';

/**
* Example object
*
* Allows sharing examples for operation responses.
* 
* @see {@link https://swagger.io/specification/v2/#example-object}
*/
export type ExamplesObject = {

};

export const parseExamplesObject = (input: unknown): ExamplesObject => isObject(input) ? { ...input } as ExamplesObject : {} as ExamplesObject;