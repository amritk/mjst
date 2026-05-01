import { isObject } from '@amritk/helpers/is-object';

export type AttributeObject = {
  name: string;
  value: string;
};

export const parseAttributeObject = (input: unknown): AttributeObject => {
  if (!isObject(input)) return {
        name: "",
        value: "",
      };
  const _name = input.name;
  const _value = input.value;
  if (typeof _name === "string" && typeof _value === "string") return { ...input } as AttributeObject;
  return {
    ...input,
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    value: typeof _value === "string" ? _value : (_value !== undefined ? String(_value) : ""),
  } as unknown as AttributeObject;
}