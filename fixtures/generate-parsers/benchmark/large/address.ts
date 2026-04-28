import { isObject } from 'mjst-helpers/is-object';

export type AddressObject = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const parseAddressObject = (input: unknown): AddressObject => {
  if (!isObject(input)) return {
        line1: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
      };
  const _line1 = input.line1;
  const _line2 = input.line2;
  const _city = input.city;
  const _state = input.state;
  const _postalCode = input.postalCode;
  const _country = input.country;
  if (typeof _line1 === "string" && (_line2 === undefined || typeof _line2 === "string") && typeof _city === "string" && typeof _state === "string" && typeof _postalCode === "string" && typeof _country === "string") return { ...input } as AddressObject;
  return {
    ...input,
    line1: typeof _line1 === "string" ? _line1 : (_line1 !== undefined ? String(_line1) : ""),
    ...(_line2 !== undefined && { line2: typeof _line2 === "string" ? _line2 : String(_line2) }),
    city: typeof _city === "string" ? _city : (_city !== undefined ? String(_city) : ""),
    state: typeof _state === "string" ? _state : (_state !== undefined ? String(_state) : ""),
    postalCode: typeof _postalCode === "string" ? _postalCode : (_postalCode !== undefined ? String(_postalCode) : ""),
    country: typeof _country === "string" ? _country : (_country !== undefined ? String(_country) : ""),
  } as unknown as AddressObject;
}