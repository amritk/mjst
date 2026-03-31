import { validateRecord } from './validators/validate-record';

/**
* Security Requirement object
*
* Lists the required security schemes to execute this operation. The name used for each property MUST correspond to a security scheme declared in the [Security Schemes](#componentsSecuritySchemes) under the [Components Object](#components-object).  Security Requirement Objects that contain multiple schemes require that all schemes MUST be satisfied for a request to be authorized. This enables support for scenarios where multiple query parameters or HTTP headers are required to convey security information.  When a list of Security Requirement Objects is defined on the [OpenAPI Object](#openapi-object) or [Operation Object](#operation-object), only one of the Security Requirement Objects in the list needs to be satisfied to authorize the request.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#security-requirement-object}
*/
export type SecurityRequirementObject = {
  [key: string]: string[];
};

export const parseSecurityRequirementObject = (input: unknown): SecurityRequirementObject => validateRecord(input, (value: unknown) => Array.isArray(value) ? value : []) as SecurityRequirementObject;