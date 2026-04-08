import { isObject } from 'mjst-helpers/is-object';

export type ContactObject = {
  name?: string;
  url?: string;
  email?: string;
} & Record<`x-${string}`, unknown>;

export const parseContactObject = (input: unknown): ContactObject => {
  if (!isObject(input)) return {};
  const _name = input.name;
  const _url = input.url;
  const _email = input.email;
  if ((_name === undefined || typeof _name === "string") && (_url === undefined || typeof _url === "string") && (_email === undefined || typeof _email === "string")) return input as ContactObject;
  return {
    ...input,
    ...(_name !== undefined && { name: typeof _name === "string" ? _name : String(_name) }),
    ...(_url !== undefined && { url: typeof _url === "string" ? _url : String(_url) }),
    ...(_email !== undefined && { email: typeof _email === "string" ? _email : String(_email) }),
  };
}