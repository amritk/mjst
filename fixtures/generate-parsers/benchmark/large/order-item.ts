import { type AttributeObject, parseAttributeObject, validateAttributeObjectShape } from './attribute';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

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

export const validateOrderItemObjectShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.id === "string"
    && typeof input.productId === "string"
    && typeof input.name === "string"
    && typeof input.sku === "string"
    && typeof input.quantity === "number"
    && typeof input.unitPrice === "number"
    && (input.discount === undefined || typeof input.discount === "number")
    && typeof input.taxRate === "number"
    && Array.isArray(input.attributes) && input.attributes.every(validateAttributeObjectShape);
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
  const _id = input.id;
  const _productId = input.productId;
  const _name = input.name;
  const _sku = input.sku;
  const _quantity = input.quantity;
  const _unitPrice = input.unitPrice;
  const _discount = input.discount;
  const _taxRate = input.taxRate;
  const _attributes = input.attributes;
  if (typeof _id === "string" && typeof _productId === "string" && typeof _name === "string" && typeof _sku === "string" && typeof _quantity === "number" && typeof _unitPrice === "number" && (_discount === undefined || typeof _discount === "number") && typeof _taxRate === "number" && Array.isArray(_attributes) && _attributes.every(validateAttributeObjectShape)) return { ...input } as OrderItemObject;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    productId: typeof _productId === "string" ? _productId : (_productId !== undefined ? String(_productId) : ""),
    name: typeof _name === "string" ? _name : (_name !== undefined ? String(_name) : ""),
    sku: typeof _sku === "string" ? _sku : (_sku !== undefined ? String(_sku) : ""),
    quantity: typeof _quantity === "number" ? _quantity : (_quantity !== undefined ? (Number.isFinite(Number(_quantity)) ? Number(_quantity) : 0) : 0),
    unitPrice: typeof _unitPrice === "number" ? _unitPrice : (_unitPrice !== undefined ? (Number.isFinite(Number(_unitPrice)) ? Number(_unitPrice) : 0) : 0),
    ...(_discount !== undefined && { discount: typeof _discount === "number" ? _discount : (Number.isFinite(Number(_discount)) ? Number(_discount) : 0) }),
    taxRate: typeof _taxRate === "number" ? _taxRate : (_taxRate !== undefined ? (Number.isFinite(Number(_taxRate)) ? Number(_taxRate) : 0) : 0),
    attributes: validateArray(_attributes, parseAttributeObject),
  } as unknown as OrderItemObject;
}