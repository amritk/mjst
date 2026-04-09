import { isObject } from 'mjst-helpers/is-object';

export type StylesForCookieObject = {
  in: "cookie";
  style: "form";
};

export const parseStylesForCookieObject = (input: unknown): StylesForCookieObject => {
  if (!isObject(input)) return {} as StylesForCookieObject;
  return {
    ...input,
    in: input?.in === "cookie" ? input?.in : "cookie",
    ...(input.style !== undefined && { style: input?.style === "form" ? input?.style : "form" }),
  } as unknown as StylesForCookieObject;
}