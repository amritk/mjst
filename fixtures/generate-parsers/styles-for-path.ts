import { isObject } from 'mjst-helpers/is-object';

export type StylesForPathObject = {
  in: "path";
  style: "matrix" | "label" | "simple";
  required: true;
};

export const parseStylesForPathObject = (input: unknown): StylesForPathObject => {
  if (!isObject(input)) return {} as StylesForPathObject;
  return {
    ...input,
    in: input?.in === "path" ? input?.in : "path",
    ...(input.style !== undefined && { style: ["matrix","label","simple"].includes(input?.style as never) ? input?.style : "simple" }),
    required: input?.required === true ? input?.required : true,
  } as unknown as StylesForPathObject;
}