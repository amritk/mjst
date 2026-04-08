import { isObject } from 'mjst-helpers/is-object';

export type VendorExtensionObject = {

};

export const parseVendorExtensionObject = (input: unknown): VendorExtensionObject => isObject(input) ? input as VendorExtensionObject : {} as VendorExtensionObject;