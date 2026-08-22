import type { FunctionRegistry, RulesetFunction } from '../../../core/types'
import { aasServerVariables } from './aas-server-variables'
import { aasTagsUnique } from './aas-tags-unique'
import { asyncApiChannelParameters } from './asyncapi-channel-parameters'
import { asyncApiChannelServers } from './asyncapi-channel-servers'
import { asyncApiDocumentSchema } from './asyncapi-document-schema'
import { asyncApiHeadersObject } from './asyncapi-headers-object'
import { asyncApiMessageExamples } from './asyncapi-message-examples'
import { asyncApiMessageIdUnique } from './asyncapi-message-id-unique'
import { asyncApiOperationIdUnique } from './asyncapi-operation-id-unique'
import { asyncApiPayload } from './asyncapi-payload'
import { asyncApiSchemaValidation } from './asyncapi-schema-validation'
import { asyncApiSecurity } from './asyncapi-security'

export { aasServerVariables } from './aas-server-variables'
export { aasTagsUnique } from './aas-tags-unique'
export { asyncApiChannelParameters } from './asyncapi-channel-parameters'
export { asyncApiChannelServers } from './asyncapi-channel-servers'
export { asyncApiDocumentSchema } from './asyncapi-document-schema'
export { asyncApiHeadersObject } from './asyncapi-headers-object'
export { asyncApiMessageExamples } from './asyncapi-message-examples'
export { asyncApiMessageIdUnique } from './asyncapi-message-id-unique'
export { asyncApiOperationIdUnique } from './asyncapi-operation-id-unique'
export { asyncApiPayload } from './asyncapi-payload'
export { asyncApiSchemaValidation, type IAsyncApiSchemaValidationOptions } from './asyncapi-schema-validation'
export { asyncApiSecurity, type IAsyncApiSecurityOptions } from './asyncapi-security'

/** The AsyncAPI-specific custom functions, keyed by name for ruleset `then` references. */
export const aasFunctions: FunctionRegistry = {
  aasServerVariables,
  aasTagsUnique,
  asyncApiChannelParameters,
  asyncApiChannelServers,
  asyncApiDocumentSchema: asyncApiDocumentSchema as RulesetFunction,
  asyncApiHeadersObject,
  asyncApiMessageExamples,
  asyncApiMessageIdUnique,
  asyncApiOperationIdUnique,
  asyncApiPayload,
  asyncApiSchemaValidation: asyncApiSchemaValidation as RulesetFunction,
  asyncApiSecurity: asyncApiSecurity as RulesetFunction,
}
