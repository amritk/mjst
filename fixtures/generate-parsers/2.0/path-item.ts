import type { OperationObject } from './operation';
import type { ParametersListObject } from './parameters-list';
import type { VendorExtensionObject } from './vendor-extension';

export type PathItemObject = {
  $ref?: string;
  get?: OperationObject;
  put?: OperationObject;
  post?: OperationObject;
  delete?: OperationObject;
  options?: OperationObject;
  head?: OperationObject;
  patch?: OperationObject;
  parameters?: ParametersListObject;
};