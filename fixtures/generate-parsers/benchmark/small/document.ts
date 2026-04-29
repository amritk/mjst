import { isObject } from 'mjst-helpers/is-object';

export type Document = {
  id: string;
  name: string;
  email: string;
  age?: number;
  isActive: boolean;
};

export const parseDocument = (input: unknown): Document => {
  if (!isObject(input)) return {
        id: "",
        name: "",
        email: "",
        isActive: false,
      };
  const _id = input.id;
  const _name = input.name;
  const _email = input.email;
  const _age = input.age;
  const _isActive = input.isActive;
  if (typeof _id === "string" && typeof _name === "string" && typeof _email === "string" && (_age === undefined || typeof _age === "number") && typeof _isActive === "boolean") return { ...input } as Document;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    email: typeof _email === "string" ? _email : (_email !== undefined ? String(_email) : ""),
    ...(_age !== undefined && { age: typeof _age === "number" ? _age : (Number.isFinite(Number(_age)) ? Number(_age) : 0) }),
    isActive: typeof _isActive === "boolean" ? _isActive : (_isActive !== undefined ? Boolean(_isActive) : false),
  } as unknown as Document;
}