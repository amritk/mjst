import { isObject } from 'mjst-helpers/is-object';

export type StylesForFormObject = {
  style: "form";
  explode: boolean;
};

export const parseStylesForFormObject = (input: unknown): StylesForFormObject => {
  if (!isObject(input)) return {
        style: undefined,
      };
  return {
    ...input,
    ...(input.explode !== undefined && { explode: input?.explode ?? true }),
    style: input?.style === "form" ? input?.style : "form",
  };
}