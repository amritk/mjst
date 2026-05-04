import { isObject } from '@amritk/helpers/is-object';

export type DiscountObject = {
  code: string;
  type: string;
  amount: number;
};

export const validateDiscountObjectShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.code === "string"
    && typeof input.type === "string"
    && typeof input.amount === "number";
};

export const parseDiscountObject = (input: unknown): DiscountObject => {
  if (!isObject(input)) return {
        code: "",
        type: "",
        amount: 0,
      };
  const _code = input.code;
  const _type = input.type;
  const _amount = input.amount;
  if (typeof _code === "string" && typeof _type === "string" && typeof _amount === "number") return { ...input } as DiscountObject;
  return {
    ...input,
    code: typeof _code === "string" ? _code : (_code !== undefined ? String(_code) : ""),
    type: typeof _type === "string" ? _type : (_type !== undefined ? String(_type) : ""),
    amount: typeof _amount === "number" ? _amount : (_amount !== undefined ? (Number.isFinite(Number(_amount)) ? Number(_amount) : 0) : 0),
  } as unknown as DiscountObject;
}