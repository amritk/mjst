import { isObject } from 'mjst-helpers/is-object';

/**
* Example object
*
* ##### Fixed Fields Field Name | Type | Description ---|:---:|--- <a name="exampleSummary"></a>summary | `string` | Short description for the example. <a name="exampleDescription"></a>description | `string` | Long description for the example. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. <a name="exampleValue"></a>value | Any | Embedded literal example. The `value` field and `externalValue` field are mutually exclusive. To represent examples of media types that cannot naturally represented in JSON or YAML, use a string value to contain the example, escaping where necessary. <a name="exampleExternalValue"></a>externalValue | `string` | A URI that points to the literal example. This provides the capability to reference examples that cannot easily be included in JSON or YAML documents.  The `value` field and `externalValue` field are mutually exclusive. See the rules for resolving [Relative References](#relative-references-in-uris).  This object MAY be extended with [Specification Extensions](#specification-extensions).  In all cases, the example value is expected to be compatible with the type schema of its associated value.  Tooling implementations MAY choose to validate compatibility automatically, and reject the example value(s) if incompatible.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#example-object}
*/
export type ExampleObject = {
  /** Short description for the example. */
  summary?: string;
  /** Long description for the example. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** Embedded literal example. The `value` field and `externalValue` field are mutually exclusive. To represent examples of media types that cannot naturally represented in JSON or YAML, use a string value to contain the example, escaping where necessary. */
  value?: boolean;
  /** A URI that points to the literal example. This provides the capability to reference examples that cannot easily be included in JSON or YAML documents.  The `value` field and `externalValue` field are mutually exclusive. See the rules for resolving [Relative References](https://spec.openapis.org/oas/v3.1#relative-references-in-uris). */
  externalValue?: string;
} & Record<`x-${string}`, unknown>;

export const parseExampleObject = (input: unknown): ExampleObject => {
  if (!isObject(input)) return {};
  return {
    ...input,
    ...(input.summary !== undefined && { summary: typeof input?.summary === "string" ? input?.summary : String(input?.summary) }),
    ...(input.description !== undefined && { description: typeof input?.description === "string" ? input?.description : String(input?.description) }),
    ...(input.externalValue !== undefined && { externalValue: typeof input?.externalValue === "string" ? input?.externalValue : String(input?.externalValue) }),
  };
}