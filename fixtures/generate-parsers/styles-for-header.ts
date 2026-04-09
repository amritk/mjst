import { isObject } from 'mjst-helpers/is-object';

export type StylesForHeaderObject = {
  in: "header";
  style: "simple";
};

export const parseStylesForHeaderObject = (input: unknown): StylesForHeaderObject => {
  if (!isObject(input)) return {} as StylesForHeaderObject;
  return {
    ...input,
    in: input?.in === "header" ? input?.in : "header",
    ...(input.style !== undefined && { style: input?.style === "simple" ? input?.style : "simple" }),
  } as unknown as StylesForHeaderObject;
}