import { isObject } from 'mjst-helpers/is-object';

export type StylesForCookieObject = {
  in: "cookie";
  style: "form";
};

export const parseStylesForCookieObject = (input: unknown): StylesForCookieObject => {
  if (!isObject(input)) return {};
  return {
    ...input,
    ...(input.in !== undefined && { in: input?.in === "cookie" ? input?.in : "cookie" }),
    ...(input.style !== undefined && { style: input?.style === "form" ? input?.style : "form" }),
  };
}