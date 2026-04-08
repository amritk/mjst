import { isObject } from 'mjst-helpers/is-object';

/**
* License object
*
* License information for the exposed API.
* 
* @see {@link https://spec.openapis.org/oas/v3.0.4#license-object}
*/
export type LicenseObject = {
  /** **REQUIRED**. The license name used for the API. */
  name: string;
  /** A URL for the license used for the API. This MUST be in the form of a URL. */
  url?: string;
};

export const parseLicenseObject = (input: unknown): LicenseObject => {
  if (!isObject(input)) return {
        name: "",
      };
  const _name = input.name;
  const _url = input.url;
  if (typeof _name === "string" && (_url === undefined || typeof _url === "string")) return input as LicenseObject;
  return {
    ...input,
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_url !== undefined && { url: typeof _url === "string" ? _url : String(_url) }),
  } as unknown as LicenseObject;
}