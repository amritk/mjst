import { Type } from '@scalar/typebox'

const Address = Type.Object({
  line1: Type.String(),
  line2: Type.Optional(Type.String()),
  city: Type.String(),
  state: Type.String(),
  postalCode: Type.String(),
  country: Type.String(),
})

const Customer = Type.Object({
  id: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  email: Type.String(),
  phone: Type.Optional(Type.String()),
})

const Attribute = Type.Object({
  name: Type.String(),
  value: Type.String(),
})

const OrderItem = Type.Object({
  id: Type.String(),
  productId: Type.String(),
  name: Type.String(),
  sku: Type.String(),
  quantity: Type.Number(),
  unitPrice: Type.Number(),
  discount: Type.Optional(Type.Number()),
  taxRate: Type.Number(),
  attributes: Type.Array(Attribute),
})

const Payment = Type.Object({
  method: Type.String(),
  transactionId: Type.String(),
  status: Type.String(),
  paidAt: Type.String(),
})

const Shipping = Type.Object({
  carrier: Type.String(),
  trackingNumber: Type.String(),
  estimatedDelivery: Type.String(),
  actualDelivery: Type.Optional(Type.String()),
})

const Discount = Type.Object({
  code: Type.String(),
  type: Type.String(),
  amount: Type.Number(),
})

const Metadata = Type.Object({
  tags: Type.Array(Type.String()),
  notes: Type.Optional(Type.String()),
})

export const OrderSchema = Type.Object({
  id: Type.String(),
  orderNumber: Type.String(),
  status: Type.String(),
  currency: Type.String(),
  totalAmount: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  customer: Customer,
  shippingAddress: Address,
  billingAddress: Address,
  items: Type.Array(OrderItem),
  payment: Payment,
  shipping: Shipping,
  discounts: Type.Array(Discount),
  metadata: Metadata,
})
