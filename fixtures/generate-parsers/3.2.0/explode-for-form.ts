import { isObject } from 'mjst-helpers/is-object';

/**
* ExplodeForFormObject
*
* for encoding objects, and query and cookie parameters, style=form is the default
*/
export type ExplodeForFormObject = {
  style: "form";
  explode: boolean;
};

export const parseExplodeForFormObject = (input: unknown): ExplodeForFormObject => {
  if (!isObject(input)) return {} as ExplodeForFormObject;
  return {
    ...input,
    ...(input.explode !== undefined && { explode: input?.explode ?? true }),
    style: input?.style === "form" ? input?.style : "form",
  } as unknown as ExplodeForFormObject;
}