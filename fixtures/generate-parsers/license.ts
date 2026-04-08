import { isObject } from 'mjst-helpers/is-object';

export type LicenseObject = {
  name: string;
  identifier?: string;
  url?: string;
} & Record<`x-${string}`, unknown>;

export const parseLicenseObject = (input: unknown): LicenseObject => {
  if (!isObject(input)) return {
        name: "",
      };
  const _name = input.name;
  const _identifier = input.identifier;
  const _url = input.url;
  if (typeof _name === "string" && (_identifier === undefined || typeof _identifier === "string") && (_url === undefined || typeof _url === "string")) return input as LicenseObject;
  return {
    ...input,
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    ...(_identifier !== undefined && { identifier: typeof _identifier === "string" ? _identifier : String(_identifier) }),
    ...(_url !== undefined && { url: typeof _url === "string" ? _url : String(_url) }),
  };
}