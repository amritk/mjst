import { type HeaderObject, parseHeaderObject } from './header';
import { validateRecord } from 'mjst-helpers/validate-record';

/**
* Headers object
*
* Lists the headers that can be sent as part of a response.
* 
* @see {@link https://swagger.io/specification/v2/#headers-object}
*/
export type HeadersObject = {
  [key: string]: HeaderObject;
};

export const parseHeadersObject = (input: unknown): HeadersObject => validateRecord(input, parseHeaderObject) as HeadersObject;