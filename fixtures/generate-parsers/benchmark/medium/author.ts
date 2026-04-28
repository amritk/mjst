import { isObject } from 'mjst-helpers/is-object';

export type AuthorObject = {
  id: string;
  name: string;
  email: string;
  bio?: string;
};

export const parseAuthorObject = (input: unknown): AuthorObject => {
  if (!isObject(input)) return {
        id: "",
        name: "",
        email: "",
      };
  const _id = input.id;
  const _name = input.name;
  const _email = input.email;
  const _bio = input.bio;
  if (typeof _id === "string" && typeof _name === "string" && typeof _email === "string" && (_bio === undefined || typeof _bio === "string")) return { ...input } as AuthorObject;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    email: typeof _email === "string" ? _email : (_email !== undefined ? String(_email) : ""),
    ...(_bio !== undefined && { bio: typeof _bio === "string" ? _bio : String(_bio) }),
  } as unknown as AuthorObject;
}