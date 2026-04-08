import { isObject } from 'mjst-helpers/is-object';

export type StylesForPathObject = {
  in: "path";
  style: "matrix" | "label" | "simple";
  required: true;
};

export const parseStylesForPathObject = (input: unknown): StylesForPathObject => {
  if (!isObject(input)) return {
        required: undefined,
      };
  return {
    ...input,
    ...(input.in !== undefined && { in: input?.in === "path" ? input?.in : "path" }),
    ...(input.style !== undefined && { style: ["matrix","label","simple"].includes(input?.style) ? input?.style : "simple" }),
    required: input?.required === true ? input?.required : true,
  };
}