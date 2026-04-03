import type { MapOfStringsObject } from './map-of-strings';

export type DeviceAuthorizationObject = {
  deviceAuthorizationUrl: string;
  tokenUrl: string;
  refreshUrl?: string;
  scopes: MapOfStringsObject;
} & Record<`x-${string}`, unknown>;