import { isObject } from '@amritk/helpers/is-object';

export type PaymentObject = {
  method: string;
  transactionId: string;
  status: string;
  paidAt: string;
};

export const parsePaymentObject = (input: unknown): PaymentObject => {
  if (!isObject(input)) return {
        method: "",
        transactionId: "",
        status: "",
        paidAt: "",
      };
  const _method = input.method;
  const _transactionId = input.transactionId;
  const _status = input.status;
  const _paidAt = input.paidAt;
  if (typeof _method === "string" && typeof _transactionId === "string" && typeof _status === "string" && typeof _paidAt === "string") return { ...input } as PaymentObject;
  return {
    ...input,
    method: typeof _method === "string" ? _method : (_method !== undefined ? String(_method) : ""),
    transactionId: typeof _transactionId === "string" ? _transactionId : (_transactionId !== undefined ? String(_transactionId) : ""),
    status: typeof _status === "string" ? _status : (_status !== undefined ? String(_status) : ""),
    paidAt: typeof _paidAt === "string" ? _paidAt : (_paidAt !== undefined ? String(_paidAt) : ""),
  } as unknown as PaymentObject;
}