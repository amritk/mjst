import { isObject } from '@amritk/helpers/is-object';

export type ShippingObject = {
  carrier: string;
  trackingNumber: string;
  estimatedDelivery: string;
  actualDelivery?: string;
};

export const parseShippingObject = (input: unknown): ShippingObject => {
  if (!isObject(input)) return {
        carrier: "",
        trackingNumber: "",
        estimatedDelivery: "",
      };
  const _carrier = input.carrier;
  const _trackingNumber = input.trackingNumber;
  const _estimatedDelivery = input.estimatedDelivery;
  const _actualDelivery = input.actualDelivery;
  if (typeof _carrier === "string" && typeof _trackingNumber === "string" && typeof _estimatedDelivery === "string" && (_actualDelivery === undefined || typeof _actualDelivery === "string")) return { ...input } as ShippingObject;
  return {
    ...input,
    carrier: typeof _carrier === "string" ? _carrier : (_carrier !== undefined ? String(_carrier) : ""),
    trackingNumber: typeof _trackingNumber === "string" ? _trackingNumber : (_trackingNumber !== undefined ? String(_trackingNumber) : ""),
    estimatedDelivery: typeof _estimatedDelivery === "string" ? _estimatedDelivery : (_estimatedDelivery !== undefined ? String(_estimatedDelivery) : ""),
    ...(_actualDelivery !== undefined && { actualDelivery: typeof _actualDelivery === "string" ? _actualDelivery : String(_actualDelivery) }),
  } as unknown as ShippingObject;
}