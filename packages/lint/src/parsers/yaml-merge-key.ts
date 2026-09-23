import { isScalar, type YamlPair } from '@amritk/yaml'

/**
 * True when a pair is a `<<` merge key, whose value folds into the parent map
 * instead of becoming a key of its own. The parser runs with `merge: true`, so
 * `toJS` never projects a `<<` key — which is why both the position lookup and
 * the non-finite scan route these pairs to their merge handling rather than
 * treating `<<` as a path segment.
 */
export const isMergePair = (pair: YamlPair): boolean => isScalar(pair.key) && pair.key.source === '<<'
