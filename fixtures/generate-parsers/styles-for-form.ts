import { isObject } from 'mjst-helpers/is-object';

export type StylesForFormObject = {
  style: "form";
  explode: boolean;
};

export const parseStylesForFormObject = (input: unknown): StylesForFormObject => {
  if (!isObject(input)) return {} as StylesForFormObject;
  return {
    ...input,
    ...(input.explode !== undefined && { explode: input?.explode ?? true }),
    style: input?.style === "form" ? input?.style : "form",
  } as unknown as StylesForFormObject;
}