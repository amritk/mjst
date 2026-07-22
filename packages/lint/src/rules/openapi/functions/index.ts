import type { FunctionRegistry, RulesetFunction } from '../../../core/types'
import { oasMediaExample, oasSchemaExample } from './example-validation'
import { oasAdditionalOperations } from './oas-additional-operations'
import { oasDiscriminator } from './oas-discriminator'
import { oasExampleExternalValue } from './oas-example-external-value'
import { oasExampleValue } from './oas-example-value'
import { oasMutuallyExclusive } from './oas-mutually-exclusive'
import { oasNoNullable } from './oas-no-nullable'
import { oasOpFormDataConsumeCheck } from './oas-op-form-data-consume-check'
import { oasOpIdUnique } from './oas-op-id-unique'
import { oasOpParams } from './oas-op-params'
import { oasOpSecurityDefined } from './oas-op-security-defined'
import { oasOpSuccessResponse } from './oas-op-success-response'
import { oasPathParam } from './oas-path-param'
import { oasSchema } from './oas-schema'
import { oasSchemaExampleDeprecated } from './oas-schema-example-deprecated'
import { oasServerNameUnique } from './oas-server-name-unique'
import { oasServerVariables } from './oas-server-variables'
import { oasTagDefined } from './oas-tag-defined'
import { oasTagKind } from './oas-tag-kind'
import { oasTagParentDefined } from './oas-tag-parent-defined'
import { oasTagsUnique } from './oas-tags-unique'
import { oasUnusedComponent } from './oas-unused-component'
import { refSiblings } from './ref-siblings'

export { type IOasExampleOptions, oasMediaExample, oasSchemaExample } from './example-validation'
export { oasAdditionalOperations } from './oas-additional-operations'
export { oasDiscriminator } from './oas-discriminator'
export { oasExampleExternalValue } from './oas-example-external-value'
export { oasExampleValue } from './oas-example-value'
export { oasMutuallyExclusive } from './oas-mutually-exclusive'
export { oasNoNullable } from './oas-no-nullable'
export { oasOpFormDataConsumeCheck } from './oas-op-form-data-consume-check'
export { oasOpIdUnique } from './oas-op-id-unique'
export { oasOpParams } from './oas-op-params'
export { oasOpSecurityDefined } from './oas-op-security-defined'
export { oasOpSuccessResponse } from './oas-op-success-response'
export { oasPathParam } from './oas-path-param'
export { type IOasSchemaOptions, oasSchema } from './oas-schema'
export { oasSchemaExampleDeprecated } from './oas-schema-example-deprecated'
export { oasServerNameUnique } from './oas-server-name-unique'
export { oasServerVariables } from './oas-server-variables'
export { oasTagDefined } from './oas-tag-defined'
export { oasTagKind } from './oas-tag-kind'
export { oasTagParentDefined } from './oas-tag-parent-defined'
export { oasTagsUnique } from './oas-tags-unique'
export { oasUnusedComponent } from './oas-unused-component'
export { refSiblings } from './ref-siblings'

/** The OpenAPI-specific custom functions, keyed by name for ruleset `then` references. */
export const oasFunctions: FunctionRegistry = {
  refSiblings,
  oasOpSuccessResponse,
  oasTagDefined,
  oasOpIdUnique,
  oasPathParam,
  oasOpParams,
  oasTagsUnique,
  oasOpSecurityDefined: oasOpSecurityDefined as RulesetFunction,
  oasOpFormDataConsumeCheck,
  oasDiscriminator,
  oasServerVariables,
  oasSchemaExample,
  oasMediaExample: oasMediaExample as RulesetFunction,
  oasUnusedComponent,
  oasMutuallyExclusive: oasMutuallyExclusive as RulesetFunction,
  oasNoNullable,
  oasSchema: oasSchema as RulesetFunction,
  oasAdditionalOperations,
  oasServerNameUnique,
  oasTagParentDefined,
  oasSchemaExampleDeprecated,
  oasTagKind,
  oasExampleValue,
  oasExampleExternalValue,
}
