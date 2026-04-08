import { type JsonReferenceObject, parseJsonReferenceObject } from './json-reference';
import { type ResponseObject, parseResponseObject } from './response';

/**
* Response object
*
* Describes a single response from an API Operation.
* 
* @see {@link https://swagger.io/specification/v2/#response-object}
*/
export type ResponseValueObject = ResponseObject | JsonReferenceObject;

export const parseResponseValueObject = (input: unknown): ResponseValueObject => input as ResponseValueObject;