import { validateRecord } from '@amritk/helpers/validate-record';

export type MapOfStringsObject = {
  [key: string]: string;
};

export const parseMapOfStringsObject = (input: unknown): MapOfStringsObject => validateRecord(input, (value: unknown) => typeof value === "string" ? value : "") as MapOfStringsObject;