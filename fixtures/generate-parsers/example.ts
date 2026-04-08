import { isObject } from 'mjst-helpers/is-object';

export type ExampleObject = {
  summary?: string;
  description?: string;
  value?: boolean;
  externalValue?: string;
} & Record<`x-${string}`, unknown>;

export const parseExampleObject = (input: unknown): ExampleObject => {
  if (!isObject(input)) return {};
  return {
    ...input,
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.externalValue !== undefined && { externalValue: typeof input?.externalValue === "string" ? input?.externalValue : String(input?.externalValue) }),
  };
}