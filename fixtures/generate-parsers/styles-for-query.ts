import { isObject } from 'mjst-helpers/is-object';

export type StylesForQueryObject = {
  in: "query";
  style: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  allowReserved: boolean;
};

export const parseStylesForQueryObject = (input: unknown): StylesForQueryObject => {
  if (!isObject(input)) return {} as StylesForQueryObject;
  return {
    ...input,
    in: input?.in === "query" ? input?.in : "query",
    ...(input.style !== undefined && { style: ["form","spaceDelimited","pipeDelimited","deepObject"].includes(input?.style as never) ? input?.style : "form" }),
    ...(input.allowReserved !== undefined && { allowReserved: typeof input?.allowReserved === "boolean" ? input?.allowReserved : Boolean(input?.allowReserved) }),
  } as unknown as StylesForQueryObject;
}