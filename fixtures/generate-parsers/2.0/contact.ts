import { isObject } from 'mjst-helpers/is-object';

/**
* Contact object
*
* Contact information for the exposed API.
* 
* @see {@link https://swagger.io/specification/v2/#contact-object}
*/
export type ContactObject = {
  /** The identifying name of the contact person/organization. */
  name?: string;
  /** The URL pointing to the contact information. MUST be in the format of a URL. */
  url?: string;
  /** The email address of the contact person/organization. MUST be in the format of an email address. */
  email?: string;
};

export const parseContactObject = (input: unknown): ContactObject => {
  if (!isObject(input)) {
    return {} as unknown as ContactObject;
  }
  const result = {
    ...input,
    ...((value => value === undefined ? {} : { name: value })(typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : undefined))),
    ...((value => value === undefined ? {} : { url: value })(typeof input?.url === "string" ? input?.url : (input?.url !== undefined ? String(input?.url) : undefined))),
    ...((value => value === undefined ? {} : { email: value })(typeof input?.email === "string" ? input?.email : (input?.email !== undefined ? String(input?.email) : undefined))),
  } as unknown as ContactObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};