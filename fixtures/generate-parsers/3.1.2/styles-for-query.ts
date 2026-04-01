import { isObject } from 'mjst-helpers/is-object';

export type StylesForQueryObject = {
  in: "query";
  style: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  allowReserved: boolean;
};

export const parseStylesForQueryObject = (input: unknown): StylesForQueryObject => {
  if (!isObject(input)) return {};
  return {
    ...input,
    ...(input.in !== undefined && { in: input?.in === "query" ? input?.in : "query" }),
    ...(input.style !== undefined && { style: ["form","spaceDelimited","pipeDelimited","deepObject"].includes(input?.style) ? input?.style : "form" }),
    ...(input.allowReserved !== undefined && { allowReserved: typeof input?.allowReserved === "boolean" ? input?.allowReserved : Boolean(input?.allowReserved) }),
  };
}