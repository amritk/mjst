import { type SecurityRequirementObject, parseSecurityRequirementObject } from './security-requirement';

export type SecurityObject = SecurityRequirementObject[];

export const parseSecurityObject = (input: unknown): SecurityObject => Array.isArray(input) ? input as SecurityObject : [] as SecurityObject;