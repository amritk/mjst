import { isObject } from '@amritk/helpers/is-object';

/**
* Contact object
*
* Contact information for the exposed API.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#contact-object}
*/
export type ContactObject = {
  /** The identifying name of the contact person/organization. */
  name?: string;
  /** The URI for the contact information. This MUST be in the form of a URI. */
  url?: string;
  /** The email address of the contact person/organization. This MUST be in the form of an email address. */
  email?: string;
} & Record<`x-${string}`, unknown>;

export const parseContactObject = (input: unknown): ContactObject => {
  if (!isObject(input)) return {} as ContactObject;
  const _name = input.name;
  const _url = input.url;
  const _email = input.email;
  if ((_name === undefined || typeof _name === "string") && (_url === undefined || typeof _url === "string") && (_email === undefined || typeof _email === "string")) return { ...input } as ContactObject;
  return {
    ...input,
    ...(_name !== undefined && { name: typeof _name === "string" ? _name : String(_name) }),
    ...(_url !== undefined && { url: typeof _url === "string" ? _url : String(_url) }),
    ...(_email !== undefined && { email: typeof _email === "string" ? _email : String(_email) }),
  } as unknown as ContactObject;
}