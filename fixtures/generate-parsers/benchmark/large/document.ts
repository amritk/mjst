import { type AddressObject, parseAddressObject, validateAddressObjectShape } from './address';
import { type CustomerObject, parseCustomerObject, validateCustomerObjectShape } from './customer';
import { type DiscountObject, parseDiscountObject, validateDiscountObjectShape } from './discount';
import { type MetadataObject, parseMetadataObject, validateMetadataObjectShape } from './metadata';
import { type OrderItemObject, parseOrderItemObject, validateOrderItemObjectShape } from './order-item';
import { type PaymentObject, parsePaymentObject, validatePaymentObjectShape } from './payment';
import { type ShippingObject, parseShippingObject, validateShippingObjectShape } from './shipping';
import { validateArray } from '@amritk/helpers/validate-array';
import { isObject } from '@amritk/helpers/is-object';

export type Document = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  customer: CustomerObject;
  shippingAddress: AddressObject;
  billingAddress: AddressObject;
  items: OrderItemObject[];
  payment: PaymentObject;
  shipping: ShippingObject;
  discounts: DiscountObject[];
  metadata: MetadataObject;
};

export const validateDocumentShape = (input: unknown): boolean => {
  if (!isObject(input)) return false;
  return typeof input.id === "string"
    && typeof input.orderNumber === "string"
    && typeof input.status === "string"
    && typeof input.currency === "string"
    && typeof input.totalAmount === "number"
    && typeof input.createdAt === "string"
    && typeof input.updatedAt === "string"
    && validateCustomerObjectShape(input.customer)
    && validateAddressObjectShape(input.shippingAddress)
    && validateAddressObjectShape(input.billingAddress)
    && Array.isArray(input.items) && input.items.every(validateOrderItemObjectShape)
    && validatePaymentObjectShape(input.payment)
    && validateShippingObjectShape(input.shipping)
    && Array.isArray(input.discounts) && input.discounts.every(validateDiscountObjectShape)
    && validateMetadataObjectShape(input.metadata);
};

export const parseDocument = (input: unknown): Document => {
  if (!isObject(input)) return {
        id: "",
        orderNumber: "",
        status: "",
        currency: "",
        totalAmount: 0,
        createdAt: "",
        updatedAt: "",
        customer: parseCustomerObject(undefined),
        shippingAddress: parseAddressObject(undefined),
        billingAddress: parseAddressObject(undefined),
        items: [],
        payment: parsePaymentObject(undefined),
        shipping: parseShippingObject(undefined),
        discounts: [],
        metadata: parseMetadataObject(undefined),
      };
  const _id = input.id;
  const _orderNumber = input.orderNumber;
  const _status = input.status;
  const _currency = input.currency;
  const _totalAmount = input.totalAmount;
  const _createdAt = input.createdAt;
  const _updatedAt = input.updatedAt;
  const _customer = input.customer;
  const _shippingAddress = input.shippingAddress;
  const _billingAddress = input.billingAddress;
  const _items = input.items;
  const _payment = input.payment;
  const _shipping = input.shipping;
  const _discounts = input.discounts;
  const _metadata = input.metadata;
  if (typeof _id === "string" && typeof _orderNumber === "string" && typeof _status === "string" && typeof _currency === "string" && typeof _totalAmount === "number" && typeof _createdAt === "string" && typeof _updatedAt === "string" && validateCustomerObjectShape(_customer) && validateAddressObjectShape(_shippingAddress) && validateAddressObjectShape(_billingAddress) && Array.isArray(_items) && _items.every(validateOrderItemObjectShape) && validatePaymentObjectShape(_payment) && validateShippingObjectShape(_shipping) && Array.isArray(_discounts) && _discounts.every(validateDiscountObjectShape) && validateMetadataObjectShape(_metadata)) return { ...input } as Document;
  return {
    ...input,
    id: typeof _id === "string" ? _id : (_id !== undefined ? String(_id) : ""),
    orderNumber: typeof _orderNumber === "string" ? _orderNumber : (_orderNumber !== undefined ? String(_orderNumber) : ""),
    status: typeof _status === "string" ? _status : (_status !== undefined ? String(_status) : ""),
    currency: typeof _currency === "string" ? _currency : (_currency !== undefined ? String(_currency) : ""),
    totalAmount: typeof _totalAmount === "number" ? _totalAmount : (_totalAmount !== undefined ? (Number.isFinite(Number(_totalAmount)) ? Number(_totalAmount) : 0) : 0),
    createdAt: typeof _createdAt === "string" ? _createdAt : (_createdAt !== undefined ? String(_createdAt) : ""),
    updatedAt: typeof _updatedAt === "string" ? _updatedAt : (_updatedAt !== undefined ? String(_updatedAt) : ""),
    customer: parseCustomerObject(_customer),
    shippingAddress: parseAddressObject(_shippingAddress),
    billingAddress: parseAddressObject(_billingAddress),
    items: validateArray(_items, parseOrderItemObject),
    payment: parsePaymentObject(_payment),
    shipping: parseShippingObject(_shipping),
    discounts: validateArray(_discounts, parseDiscountObject),
    metadata: parseMetadataObject(_metadata),
  } as unknown as Document;
}