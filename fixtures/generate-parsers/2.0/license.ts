import { isObject } from 'mjst-helpers/is-object';

/**
* License object
*
* License information for the exposed API.
* 
* @see {@link https://swagger.io/specification/v2/#license-object}
*/
export type LicenseObject = {
  /** **Required.** The license name used for the API. */
  name: string;
  /** A URL to the license used for the API. MUST be in the format of a URL. */
  url?: string;
};

export const parseLicenseObject = (input: unknown): LicenseObject => {
  if (!isObject(input)) {
    return {} as unknown as LicenseObject;
  }
  const result = {
    ...input,
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    ...((value => value === undefined ? {} : { url: value })(typeof input?.url === "string" ? input?.url : (input?.url !== undefined ? String(input?.url) : undefined))),
  } as unknown as LicenseObject;
  for (const key in input) {
    if (/^x-/.test(key)) {
      const value = input[key];
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
};