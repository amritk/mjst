import { isObject } from '@amritk/helpers/is-object';

export type CustomerObject = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
};

export const validateCustomerObjectShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.id === "string"
    && typeof input.firstName === "string"
    && typeof input.lastName === "string"
    && typeof input.email === "string"
    && (input.phone === undefined || typeof input.phone === "string");
};

export const parseCustomerObject = (input: unknown): CustomerObject => {
  if (!isObject(input)) return {
        id: "",
        firstName: "",
        lastName: "",
        email: "",
      };
  const _id = input.id;
  const _firstName = input.firstName;
  const _lastName = input.lastName;
  const _email = input.email;
  const _phone = input.phone;
  if (typeof _id === "string" && typeof _firstName === "string" && typeof _lastName === "string" && typeof _email === "string" && (_phone === undefined || typeof _phone === "string")) return { ...input } as CustomerObject;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    firstName: typeof _firstName === "string" ? _firstName : (_firstName !== undefined ? String(_firstName) : ""),
    lastName: typeof _lastName === "string" ? _lastName : (_lastName !== undefined ? String(_lastName) : ""),
    email: typeof _email === "string" ? _email : (_email !== undefined ? String(_email) : ""),
    ...(_phone !== undefined && { phone: typeof _phone === "string" ? _phone : String(_phone) }),
  } as unknown as CustomerObject;
}