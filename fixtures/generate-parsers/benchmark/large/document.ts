import { type AddressObject, parseAddressObject } from './address';
import { type CustomerObject, parseCustomerObject } from './customer';
import { type DiscountObject, parseDiscountObject } from './discount';
import { type MetadataObject, parseMetadataObject } from './metadata';
import { type OrderItemObject, parseOrderItemObject } from './order-item';
import { type PaymentObject, parsePaymentObject } from './payment';
import { type ShippingObject, parseShippingObject } from './shipping';
import { validateArray } from 'mjst-helpers/validate-array';
import { isObject } from 'mjst-helpers/is-object';

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
  const _customer = input.customer;
  const _shippingAddress = input.shippingAddress;
  const _billingAddress = input.billingAddress;
  const _items = input.items;
  const _payment = input.payment;
  const _shipping = input.shipping;
  const _discounts = input.discounts;
  const _metadata = input.metadata;
  return {
    ...input,
    id: typeof input?.id === "string" ? input?.id : (input?.id !== undefined ? String(input?.id) : ""),
    orderNumber: typeof input?.orderNumber === "string" ? input?.orderNumber : (input?.orderNumber !== undefined ? String(input?.orderNumber) : ""),
    status: typeof input?.status === "string" ? input?.status : (input?.status !== undefined ? String(input?.status) : ""),
    currency: typeof input?.currency === "string" ? input?.currency : (input?.currency !== undefined ? String(input?.currency) : ""),
    totalAmount: typeof input?.totalAmount === "number" ? input?.totalAmount : (input?.totalAmount !== undefined ? (Number.isFinite(Number(input?.totalAmount)) ? Number(input?.totalAmount) : 0) : 0),
    createdAt: typeof input?.createdAt === "string" ? input?.createdAt : (input?.createdAt !== undefined ? String(input?.createdAt) : ""),
    updatedAt: typeof input?.updatedAt === "string" ? input?.updatedAt : (input?.updatedAt !== undefined ? String(input?.updatedAt) : ""),
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