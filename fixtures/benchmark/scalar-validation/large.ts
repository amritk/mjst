import { array, number, object, optional, string } from '@scalar/validation'

const address = object({
  line1: string(),
  line2: optional(string()),
  city: string(),
  state: string(),
  postalCode: string(),
  country: string(),
})

const customer = object({
  id: string(),
  firstName: string(),
  lastName: string(),
  email: string(),
  phone: optional(string()),
})

const attribute = object({
  name: string(),
  value: string(),
})

const orderItem = object({
  id: string(),
  productId: string(),
  name: string(),
  sku: string(),
  quantity: number(),
  unitPrice: number(),
  discount: optional(number()),
  taxRate: number(),
  attributes: array(attribute),
})

const payment = object({
  method: string(),
  transactionId: string(),
  status: string(),
  paidAt: string(),
})

const shipping = object({
  carrier: string(),
  trackingNumber: string(),
  estimatedDelivery: string(),
  actualDelivery: optional(string()),
})

const discount = object({
  code: string(),
  type: string(),
  amount: number(),
})

const metadata = object({
  tags: array(string()),
  notes: optional(string()),
})

export const orderSchema = object({
  id: string(),
  orderNumber: string(),
  status: string(),
  currency: string(),
  totalAmount: number(),
  createdAt: string(),
  updatedAt: string(),
  customer,
  shippingAddress: address,
  billingAddress: address,
  items: array(orderItem),
  payment,
  shipping,
  discounts: array(discount),
  metadata,
})
