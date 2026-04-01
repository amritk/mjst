import { isObject } from 'mjst-helpers/is-object';

export type StylesForHeaderObject = {
  in: "header";
  style: "simple";
};

export const parseStylesForHeaderObject = (input: unknown): StylesForHeaderObject => {
  if (!isObject(input)) return {};
  return {
    ...input,
    ...(input.in !== undefined && { in: input?.in === "header" ? input?.in : "header" }),
    ...(input.style !== undefined && { style: input?.style === "simple" ? input?.style : "simple" }),
  };
}