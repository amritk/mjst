import { type AttributeObject, parseAttributeObject } from './attribute';
import { validateArray } from 'mjst-helpers/validate-array';
import { isObject } from 'mjst-helpers/is-object';

export type OrderItemObject = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
  attributes: AttributeObject[];
};

export const parseOrderItemObject = (input: unknown): OrderItemObject => {
  if (!isObject(input)) return {
        id: "",
        productId: "",
        name: "",
        sku: "",
        quantity: 0,
        unitPrice: 0,
        taxRate: 0,
        attributes: [],
      };
  const _attributes = input.attributes;
  return {
    ...input,
    id: typeof input?.id === "string" ? input?.id : (input?.id !== undefined ? String(input?.id) : ""),
    productId: typeof input?.productId === "string" ? input?.productId : (input?.productId !== undefined ? String(input?.productId) : ""),
    name: typeof input?.name === "string" ? input?.name : (input?.name !== undefined ? String(input?.name) : ""),
    sku: typeof input?.sku === "string" ? input?.sku : (input?.sku !== undefined ? String(input?.sku) : ""),
    quantity: typeof input?.quantity === "number" ? input?.quantity : (input?.quantity !== undefined ? (Number.isFinite(Number(input?.quantity)) ? Number(input?.quantity) : 0) : 0),
    unitPrice: typeof input?.unitPrice === "number" ? input?.unitPrice : (input?.unitPrice !== undefined ? (Number.isFinite(Number(input?.unitPrice)) ? Number(input?.unitPrice) : 0) : 0),
    ...(input.discount !== undefined && { discount: typeof input?.discount === "number" ? input?.discount : (Number.isFinite(Number(input?.discount)) ? Number(input?.discount) : 0) }),
    taxRate: typeof input?.taxRate === "number" ? input?.taxRate : (input?.taxRate !== undefined ? (Number.isFinite(Number(input?.taxRate)) ? Number(input?.taxRate) : 0) : 0),
    attributes: validateArray(_attributes, parseAttributeObject),
  } as unknown as OrderItemObject;
}