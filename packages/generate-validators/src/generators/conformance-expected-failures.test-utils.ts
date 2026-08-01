import type { ExpectedFailures } from '../../../../fixtures/json-schema-test-suite/load-suite'

/**
 * The official JSON Schema Test Suite cases the *generated* validators do not
 * handle, each with the reason.
 *
 * The generator is a build-time subset by design — it trades keyword coverage for
 * flat, readable, dependency-free output — so this list is long (481 of 1299
 * cases). Its job is to make that subset exact rather than approximate:
 * `conformance.test.ts` fails if a case listed here starts passing (the entry
 * must go) or if a case not listed here starts failing (a regression).
 *
 * Keys are case ids — `<file>/<group description>/<test description>` — or a
 * `/`-bounded prefix of one when a whole group or file falls to a single cause.
 * Look one up in `fixtures/json-schema-test-suite/draft2020-12/<file>`.
 *
 * Reading the sections in order gives the shape of the subset: what the generator
 * silently lets through (`typeless`, `boolean subschema`, `applicator scope`),
 * what it is stricter about than the spec (`implied type`), what it refuses
 * outright (`unevaluated*`, most `$id`-based refs), and the two places it emits
 * output that does not compile.
 */
export const EXPECTED_FAILURES: ExpectedFailures = {
  // ---------------------------------------------------------------------------
  // typeless: a schema with no root `type` compiles to an accept-everything validator
  //
  // The generator hangs every check off the declared `type` — that is what tells
  // it which shape of code to emit — so `{ "minLength": 2 }`, `{ "required": ["a"] }`
  // and `{ "uniqueItems": true }` each produce `validateRoot = () => true`. It is
  // the largest gap here by a wide margin, and the only silent one: the schema
  // generates cleanly and the validator accepts everything. Writing the same
  // schema with a `"type"` makes the keyword enforced.
  // ---------------------------------------------------------------------------
  'additionalProperties.json/non-ASCII pattern with additionalProperties/not matching the pattern is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'additionalProperties.json/additionalProperties can exist by itself/an additional invalid property is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'additionalProperties.json/additionalProperties with propertyNames/Valid against propertyNames, but not additionalProperties':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/contains keyword validation/array without items matching schema is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/contains keyword validation/empty array is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/contains keyword with const keyword/array without item 5 is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/contains keyword with boolean schema true/empty array is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/contains keyword with boolean schema false/any non-empty array is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/contains keyword with boolean schema false/empty array is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/items + contains/matches items, does not match contains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/items + contains/does not match items, matches contains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/items + contains/matches neither items nor contains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'contains.json/contains with false if subschema/empty array is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentRequired.json/single dependency/missing dependency':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentRequired.json/multiple dependents required/missing dependency':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentRequired.json/multiple dependents required/missing other dependency':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentRequired.json/multiple dependents required/missing both dependencies':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentRequired.json/dependencies with escaped characters/CRLF missing dependent':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentRequired.json/dependencies with escaped characters/quoted quotes missing dependent':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/single dependency/wrong type':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/single dependency/wrong type other':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/single dependency/wrong type both':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/boolean subschemas/object with property having schema false is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/boolean subschemas/object with both properties is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/dependencies with escaped characters/quoted quote':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/dependencies with escaped characters/quoted tab invalid under dependent schema':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'dependentSchemas.json/dependencies with escaped characters/quoted quote invalid under dependent schema':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'exclusiveMaximum.json/exclusiveMaximum validation/boundary point is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'exclusiveMaximum.json/exclusiveMaximum validation/above the exclusiveMaximum is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'exclusiveMinimum.json/exclusiveMinimum validation/boundary point is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'exclusiveMinimum.json/exclusiveMinimum validation/below the exclusiveMinimum is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'items.json/a schema given for items/wrong type of items':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'items.json/items with boolean schema (false)/any non-empty array is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'items.json/prefixItems with no additional items allowed/additional items are not permitted':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'items.json/prefixItems validation adjusts the starting index for items/wrong type of second item':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'items.json/items with heterogeneous array/heterogeneous invalid instance':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxContains.json/maxContains with contains/empty data':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxContains.json/maxContains with contains/all elements match, invalid maxContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxContains.json/maxContains with contains/some elements match, invalid maxContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxContains.json/maxContains with contains, value with a decimal/too many elements match, invalid maxContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxContains.json/minContains < maxContains/actual < minContains < maxContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxContains.json/minContains < maxContains/minContains < maxContains < actual':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxContains.json/maxContains = 0 with minContains = 0/one matching item':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxItems.json/maxItems validation/too long is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxItems.json/maxItems validation with a decimal/too long is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxLength.json/maxLength validation/too long is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxLength.json/maxLength validation with a decimal/too long is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxProperties.json/maxProperties validation/too long is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxProperties.json/maxProperties validation with a decimal/too long is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maxProperties.json/maxProperties = 0 means the object is empty/one property is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maximum.json/maximum validation/above the maximum is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'maximum.json/maximum validation with unsigned integer/above the maximum is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/minContains=1 with contains/empty data':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/minContains=1 with contains/no elements match':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/minContains=2 with contains/empty data':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/minContains=2 with contains/all elements match, invalid minContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/minContains=2 with contains/some elements match, invalid minContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/minContains=2 with contains with a decimal value/one element matches, invalid minContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/maxContains = minContains/empty data':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/maxContains = minContains/all elements match, invalid minContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/maxContains = minContains/all elements match, invalid maxContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/maxContains < minContains':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minContains.json/minContains = 0 with maxContains/too many':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minItems.json/minItems validation/too short is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minItems.json/minItems validation with a decimal/too short is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minLength.json/minLength validation/too short is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minLength.json/minLength validation/one grapheme is not long enough':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minLength.json/minLength validation with a decimal/too short is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minProperties.json/minProperties validation/too short is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minProperties.json/minProperties validation with a decimal/too short is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minimum.json/minimum validation/below the minimum is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minimum.json/minimum validation with signed integer/float below the minimum is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'minimum.json/minimum validation with signed integer/int below the minimum is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'multipleOf.json/by int/int by int fail':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'multipleOf.json/by number/35 is not multiple of 1.5':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'multipleOf.json/by small number/0.00751 is not multiple of 0.0001':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'pattern.json/pattern validation/a non-matching pattern is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/patternProperties validates properties matching a regex/a single invalid match is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/patternProperties validates properties matching a regex/multiple invalid matches is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/multiple simultaneous patternProperties are validated/an invalid due to one is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/multiple simultaneous patternProperties are validated/an invalid due to the other is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/multiple simultaneous patternProperties are validated/an invalid due to both is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/regexes are not anchored by default and are case sensitive/recognized members are accounted for':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/regexes are not anchored by default and are case sensitive/regexes are case sensitive, 2':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/patternProperties with boolean schemas/object with property matching schema false is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/patternProperties with boolean schemas/object with both properties is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'patternProperties.json/patternProperties with boolean schemas/object with a property matching both true and false is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'prefixItems.json/a schema given for prefixItems/wrong types':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'prefixItems.json/prefixItems with boolean schemas/array with two items is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'propertyNames.json/propertyNames validation/some property names invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'propertyNames.json/propertyNames validation with pattern/non-matching property name is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'propertyNames.json/propertyNames with boolean schema false/object with any properties is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'propertyNames.json/propertyNames with const/object with any other property is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'propertyNames.json/propertyNames with enum/object with any other property is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'ref.json/relative pointer ref to array/mismatch array':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'refRemote.json/base URI change/base URI change ref invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'required.json/required with escaped characters/object with some properties missing is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'required.json/required properties whose names are Javascript object property names/none of the properties mentioned':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'required.json/required properties whose names are Javascript object property names/__proto__ present':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'required.json/required properties whose names are Javascript object property names/toString present':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'required.json/required properties whose names are Javascript object property names/constructor present':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique array of integers is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique array of more than two integers is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/numbers are unique if mathematically unequal':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique array of strings is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique array of objects is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/property order of array of objects is ignored':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique array of nested objects is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique array of arrays is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique array of more than two arrays is invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/non-unique heterogeneous types are invalid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems validation/objects are non-unique despite key order':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems with an array of items/[false, false] from items array is not valid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems with an array of items/[true, true] from items array is not valid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems with an array of items/non-unique array extended from [false, true] is not valid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems with an array of items/non-unique array extended from [true, false] is not valid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems with an array of items and additionalItems=false/[false, false] from items array is not valid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems with an array of items and additionalItems=false/[true, true] from items array is not valid':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems with an array of items and additionalItems=false/extra items are invalid even if unique':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',
  'uniqueItems.json/uniqueItems=false with an array of items and additionalItems=false/extra items are invalid even if unique':
    'typeless: no root `type`, so the schema compiles to an accept-everything validator',

  // ---------------------------------------------------------------------------
  // implied type: object keywords compile to an object check
  //
  // The mirror image of the gap above. `{ "required": ["foo"] }` says nothing
  // about non-objects — a string satisfies it — but a schema carrying
  // `properties`/`required` alongside another keyword is read as an object schema,
  // so anything that is not an object is rejected. Stricter than the spec, never
  // looser.
  // ---------------------------------------------------------------------------
  'additionalProperties.json/additionalProperties being false does not allow other properties/ignores arrays':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'additionalProperties.json/additionalProperties being false does not allow other properties/ignores strings':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'additionalProperties.json/additionalProperties being false does not allow other properties/ignores other non-objects':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/object properties validation/ignores arrays':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/object properties validation/ignores other non-objects':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/properties whose names are Javascript object property names/ignores arrays':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'properties.json/properties whose names are Javascript object property names/ignores other non-objects':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'ref.json/root pointer ref/match':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'ref.json/root pointer ref/recursive match':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores arrays':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores strings':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores other non-objects':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores null':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',
  'required.json/required validation/ignores boolean':
    'implied type: `properties`/`required` compile to an object check, so a non-object is rejected instead of ignored',

  // ---------------------------------------------------------------------------
  // boolean subschema: `false` in a subschema position accepts
  //
  // `false` is the schema that rejects everything. In a `properties`, `allOf`,
  // `then` or `else` position it emits no check at all, so the branch that should
  // have failed the instance passes it.
  // ---------------------------------------------------------------------------
  'allOf.json/allOf with boolean schemas, some false':
    'boolean subschema: a `false` subschema accepts instead of rejecting',
  'allOf.json/allOf with boolean schemas, all false':
    'boolean subschema: a `false` subschema accepts instead of rejecting',
  'if-then-else.json/then: false fails when condition matches/matches if \u2192 then=false \u2192 invalid':
    'boolean subschema: a `false` subschema accepts instead of rejecting',
  'if-then-else.json/else: false fails when condition does not match/does not match if \u2192 else executes \u2192 invalid':
    'boolean subschema: a `false` subschema accepts instead of rejecting',
  "properties.json/properties with boolean schema/only 'false' property present is invalid":
    'boolean subschema: a `false` subschema accepts instead of rejecting',
  'properties.json/properties with boolean schema/both properties present is invalid':
    'boolean subschema: a `false` subschema accepts instead of rejecting',

  // ---------------------------------------------------------------------------
  // applicator scope: `allOf` members are flattened into their parent
  //
  // `additionalProperties` and `items` only see the `properties`/`prefixItems`
  // *adjacent* to them, never ones nested inside an `allOf`. Flattening the `allOf`
  // into the parent — which is what makes the flat output possible — loses that
  // distinction, so both keywords skip values they should have checked.
  // ---------------------------------------------------------------------------
  'additionalProperties.json/additionalProperties does not look in applicators':
    'applicator scope: a `properties`/`prefixItems` inside `allOf` is read as a sibling, so the adjacent `additionalProperties`/`items` skips what it matched',
  'items.json/items does not look in applicators, valid case/prefixItems in allOf does not constrain items, invalid case':
    'applicator scope: a `properties`/`prefixItems` inside `allOf` is read as a sibling, so the adjacent `additionalProperties`/`items` skips what it matched',

  // ---------------------------------------------------------------------------
  // not: inverting a multi-type subschema
  // ---------------------------------------------------------------------------
  'not.json/not multiple types/valid':
    'not: a `not` over a `type` array compiles to an unconditional failure, so every instance is rejected',

  // ---------------------------------------------------------------------------
  // refused: `unevaluatedItems` / `unevaluatedProperties`
  //
  // Both depend on annotations collected across the whole applicator tree, which
  // flat generated code cannot carry. Generation stops with an explanation rather
  // than emit a validator that would quietly accept what the interpreter rejects,
  // so these cost a build error, never a wrong verdict — validate such a schema
  // with `@amritk/runtime-validators` instead.
  // ---------------------------------------------------------------------------
  'dynamicRef.json/strict-tree schema, guards against misspelled properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "not.json/collect annotations inside a 'not', even if collection is disabled":
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'ref.json/ref creates new scope when adjacent to keywords':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems false':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems as schema':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with uniform items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with tuple':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with items and prefixItems':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested tuple':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested prefixItems and items':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with nested unevaluatedItems':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with anyOf':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with oneOf':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with not':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with if/then/else':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with boolean schemas':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with $ref':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems before $ref':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with $dynamicRef':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "unevaluatedItems.json/unevaluatedItems can't see inside cousins":
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/item is evaluated in an uncle schema to unevaluatedItems':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems depends on adjacent contains':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems depends on multiple nested contains':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems and contains interact to control item dependency relationship':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with minContains = 0':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/non-array instances are valid':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems with null instance elements':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/unevaluatedItems can see annotations from if without then and else':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedItems.json/Evaluated items collection needs to consider instance location':
    'refused: `unevaluatedItems` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties schema':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties false':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent patternProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent bool additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with adjacent non-bool additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested patternProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with nested unevaluatedProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with anyOf':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with oneOf':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with not':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with if/then/else':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with if/then/else, then not defined':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with if/then/else, else not defined':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with dependentSchemas':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with boolean schemas':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with $ref':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties before $ref':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with $dynamicRef':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "unevaluatedProperties.json/unevaluatedProperties can't see inside cousins":
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  "unevaluatedProperties.json/unevaluatedProperties can't see inside cousins (reverse order)":
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer false, inner true, properties outside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer false, inner true, properties inside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer true, inner false, properties outside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/nested unevaluatedProperties, outer true, inner false, properties inside':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/cousin unevaluatedProperties, true and false, true with properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/cousin unevaluatedProperties, true and false, false with properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/property is evaluated in an uncle schema to unevaluatedProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/in-place applicator siblings, allOf has unevaluated':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/in-place applicator siblings, anyOf has unevaluated':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties + single cyclic ref':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties + ref inside allOf / oneOf':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/dynamic evalation inside nested refs':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/non-object instances are valid':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties with null valued instance properties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties not affected by propertyNames':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/unevaluatedProperties can see annotations from if without then and else':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/dependentSchemas with unevaluatedProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/Evaluated properties collection needs to consider instance location':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/Evaluated properties collection needs to consider instance location with patternProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',
  'unevaluatedProperties.json/Evaluated properties collection needs to consider instance location with additionalProperties':
    'refused: `unevaluatedProperties` needs annotations flat generated code cannot carry, so generation stops instead of emitting a permissive validator',

  // ---------------------------------------------------------------------------
  // base URI: refs that only resolve by applying `$id`
  //
  // The ref graph is walked within one document, by JSON Pointer and `$anchor`.
  // A `$ref` written against an `$id` — relative, absolute, or a URN — and a
  // `$dynamicRef` resolved through the dynamic scope have no in-document target.
  // The same boundary `@amritk/runtime-validators` has, refused earlier: at
  // generation, with a message naming the ref.
  // ---------------------------------------------------------------------------
  'anchor.json/Location-independent identifier with absolute URI':
    'base URI: the target is another document, which the generator does not fetch',
  'anchor.json/Location-independent identifier with base URI change in subschema':
    'base URI: the target is another document, which the generator does not fetch',
  'defs.json': 'base URI: the target is another document, which the generator does not fetch',
  'dynamicRef.json/A $dynamicRef to an $anchor in the same schema resource behaves like a normal $ref to an $anchor':
    'base URI: `$dynamicRef` "#items" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema with a matching $dynamicAnchor resolves to the first $dynamicAnchor in the dynamic scope':
    'base URI: `$dynamicRef` "extended#meta" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/A $dynamicRef that initially resolves to a schema without a matching $dynamicAnchor behaves like a normal $ref to $anchor':
    'base URI: `$dynamicRef` "extended#meta" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/after leaving a dynamic scope, it is not used by a $dynamicRef':
    'base URI: `$dynamicRef` "inner_scope#thingy" is addressed through an `$id`, not by a `$dynamicAnchor` name',
  'dynamicRef.json/$ref to $dynamicRef finds detached $dynamicAnchor':
    'base URI: the target is another document, which the generator does not fetch',
  'ref.json/escaped pointer ref': 'base URI: "#/$defs/percent%25field" resolves only by applying `$id` as a base URI',
  'ref.json/remote ref, containing refs itself':
    'base URI: the target is another document, which the generator does not fetch',
  'ref.json/$ref to boolean schema true': 'base URI: "#/$defs/bool" resolves only by applying `$id` as a base URI',
  'ref.json/$ref to boolean schema false': 'base URI: "#/$defs/bool" resolves only by applying `$id` as a base URI',
  'ref.json/refs with quote': 'base URI: "#/$defs/foo%22bar" resolves only by applying `$id` as a base URI',
  'ref.json/refs with relative uris and defs': 'base URI: a nested `$id` re-bases the `#/$defs/...` pointers inside it',
  'ref.json/relative refs with absolute uris and defs':
    'base URI: a nested `$id` re-bases the `#/$defs/...` pointers inside it',
  'ref.json/$id must be resolved against nearest parent, not just immediate parent':
    'base URI: "http://example.com/b/d.json" resolves only by applying `$id` as a base URI',
  'ref.json/order of evaluation: $id and $anchor and $ref/data is invalid against first definition':
    'base URI: two `$anchor`s of the same name in different `$id` scopes collapse into one',
  'ref.json/URN ref with nested pointer ref': 'base URI: a nested `$id` re-bases the `#/$defs/...` pointers inside it',
  'ref.json/ref to if': 'base URI: "http://example.com/ref/if" resolves only by applying `$id` as a base URI',
  'ref.json/ref to then': 'base URI: "http://example.com/ref/then" resolves only by applying `$id` as a base URI',
  'ref.json/ref to else': 'base URI: "http://example.com/ref/else" resolves only by applying `$id` as a base URI',
  'ref.json/empty tokens in $ref json-pointer':
    'base URI: "#/$defs//$defs/" resolves only by applying `$id` as a base URI',
  'refRemote.json/remote ref': 'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/fragment within remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/anchor within remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/ref within remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/Location-independent identifier in remote ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/remote HTTP ref with different $id':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/remote HTTP ref with different URN $id':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/remote HTTP ref with nested absolute ref':
    'base URI: the target is another document, which the generator does not fetch',
  'refRemote.json/$ref to $ref finds detached $anchor':
    'base URI: the target is another document, which the generator does not fetch',

  // ---------------------------------------------------------------------------
  // base URI (uncaught): the output calls a validator that is never emitted
  //
  // The same class of ref, reaching the generator through a path that does not
  // refuse: it derives a name from the ref string (`int.json` → `validateIntJson`),
  // emits the call and the import, and writes no such file. The generated output
  // does not compile. Still a loud failure, but at the consumer's build instead of
  // at generation — the wrong place for it, and the reason these entries are the
  // ones worth closing first.
  // ---------------------------------------------------------------------------
  'anchor.json/same $anchor with different base uri':
    'ref (uncaught): the output calls `validateChild1MyAnchor`, which the generator never emits',
  'dynamicRef.json/A $dynamicRef resolves to the first $dynamicAnchor still in scope that is encountered when the schema is evaluated':
    'ref (uncaught): the output calls `list.js`, which the generator never emits',
  'dynamicRef.json/A $dynamicRef without anchor in fragment behaves identical to $ref':
    'ref (uncaught): the output calls `list.js`, which the generator never emits',
  "dynamicRef.json/A $dynamicRef with intermediate scopes that don't include a matching $dynamicAnchor does not affect dynamic scope resolution":
    'ref (uncaught): the output calls `intermediate-scope.js`, which the generator never emits',
  'dynamicRef.json/An $anchor with the same name as a $dynamicAnchor is not used for dynamic scope resolution':
    'ref (uncaught): the output calls `list.js`, which the generator never emits',
  'dynamicRef.json/A $dynamicRef without a matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'ref (uncaught): the output calls `list.js`, which the generator never emits',
  'dynamicRef.json/A $dynamicRef with a non-matching $dynamicAnchor in the same schema resource behaves like a normal $ref to $anchor':
    'ref (uncaught): the output calls `list.js`, which the generator never emits',
  'dynamicRef.json/multiple dynamic paths to the $dynamicRef keyword':
    'ref (uncaught): the output calls `number-list.js`, which the generator never emits',
  'dynamicRef.json/tests for implementation dynamic anchor and reference link':
    'ref (uncaught): the output calls `validateExtendibleDynamicRefJson`, which the generator never emits',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $defs first':
    'ref (uncaught): the output calls `validateExtendibleDynamicRefJson`, which the generator never emits',
  'dynamicRef.json/$ref and $dynamicAnchor are independent of order - $ref first':
    'ref (uncaught): the output calls `validateExtendibleDynamicRefJson`, which the generator never emits',
  'dynamicRef.json/$dynamicRef points to a boolean schema':
    'ref (uncaught): the output calls `validateTrue`, which the generator never emits',
  'dynamicRef.json/$dynamicRef skips over intermediate resources - direct reference':
    'ref (uncaught): the output calls `validateItem`, which the generator never emits',
  'dynamicRef.json/$dynamicRef avoids the root of each schema, but scopes are still registered':
    'ref (uncaught): the output calls `stuff.js`, which the generator never emits',
  'ref.json/Recursive references between schemas':
    'ref (uncaught): the output calls `node.js`, which the generator never emits',
  'ref.json/order of evaluation: $id and $ref':
    'ref (uncaught): the output calls `validateIntJson`, which the generator never emits',
  'ref.json/order of evaluation: $id and $ref on nested schema':
    'ref (uncaught): the output calls `validateFooJson`, which the generator never emits',
  'ref.json/simple URN base URI with $ref via the URN':
    'ref (uncaught): the output calls `validateUrnUuidDeadbeef1234FfffFfff4321feebdaed`, which the generator never emits',
  'ref.json/URN base URI with URN and JSON pointer ref':
    'ref (uncaught): the output calls `validateBar`, which the generator never emits',
  'ref.json/URN base URI with URN and anchor ref':
    'ref (uncaught): the output calls `validateUrnUuidDeadbeef1234Ff0000ff4321feebdaedSomething`, which the generator never emits',
  'ref.json/ref with absolute-path-reference':
    'ref (uncaught): the output calls `validateFoobarJson`, which the generator never emits',
  'refRemote.json/base URI change - change folder':
    'ref (uncaught): the output calls `validateRef1u41oyz`, which the generator never emits',
  'refRemote.json/base URI change - change folder in subschema':
    'ref (uncaught): the output calls `validateBar`, which the generator never emits',
  'refRemote.json/root ref in remote ref':
    'ref (uncaught): the output calls `validateOrNull`, which the generator never emits',
  'refRemote.json/remote ref with ref to defs':
    'ref (uncaught): the output calls `validateRefAndDefsJson`, which the generator never emits',
  'refRemote.json/retrieved nested refs resolve relative to their URI not $id':
    'ref (uncaught): the output calls `validateFooRefStringJson`, which the generator never emits',

  // ---------------------------------------------------------------------------
  // boolean schema at the root
  // ---------------------------------------------------------------------------
  "boolean_schema.json/boolean schema 'false'":
    'boolean schema: a root of `false` compiles to an accept-everything validator',

  // ---------------------------------------------------------------------------
  // arithmetic and regex flags
  //
  // Judgement calls rather than missing features. `multipleOf` compares the
  // quotient to its nearest integer within a scaled tolerance (the shared
  // `@amritk/helpers/multiple-of-check`, chosen so `0.3` satisfies
  // `multipleOf: 0.1`); a quotient that overflows to `Infinity` makes that
  // comparison `NaN`, which the check reads as passing. And `pattern` compiles
  // without the `u` flag, so ECMAScript Unicode property escapes are inert.
  // ---------------------------------------------------------------------------
  'multipleOf.json/float division = inf':
    'arithmetic: an overflowing quotient makes the tolerance comparison `NaN`, and `NaN > tolerance` is false, so the value reads as a clean multiple',
  'pattern.json/pattern with Unicode property escape requires unicode mode/ASCII letters match':
    'regex: `pattern` compiles without the `u` flag, so a Unicode property escape never matches',
  'pattern.json/pattern with Unicode property escape requires unicode mode/Non-ASCII letters match':
    'regex: `pattern` compiles without the `u` flag, so a Unicode property escape never matches',

  // ---------------------------------------------------------------------------
  // vocabulary: `$vocabulary` in a custom metaschema
  //
  // A custom metaschema can switch the validation vocabulary off, after which
  // `minimum` and friends never fail. Reading it means fetching the metaschema
  // named by `$schema` — I/O the generator does not do — so everything stays
  // enforced instead.
  // ---------------------------------------------------------------------------
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/applicator vocabulary still works':
    'vocabulary: the custom metaschema is a remote `$ref` the generator cannot fetch',
  'vocabulary.json/schema that uses custom metaschema with with no validation vocabulary/no validation: invalid number, but it still validates':
    'vocabulary: `$vocabulary` in a fetched metaschema cannot switch validation off',
}
