import { validateRecord } from '@amritk/helpers/validate-record';

export type SecurityRequirementObject = {
  [key: string]: string[];
};

export const parseSecurityRequirementObject = (input: unknown): SecurityRequirementObject => validateRecord(input, (value: unknown) => Array.isArray(value) ? value : []) as SecurityRequirementObject;