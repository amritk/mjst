import type { YamlAlias, YamlMap, YamlNode, YamlPair, YamlScalar, YamlSeq } from './types'

/**
 * Narrowing guards over the node union. They let consumers walk a tree without
 * reaching for `kind` string comparisons, mirroring the ergonomics of the
 * mainstream `yaml` package so swapping parsers is mechanical.
 */

export const isScalar = (node: unknown): node is YamlScalar =>
  typeof node === 'object' && node !== null && (node as YamlNode).kind === 'scalar'

export const isAlias = (node: unknown): node is YamlAlias =>
  typeof node === 'object' && node !== null && (node as YamlNode).kind === 'alias'

export const isMap = (node: unknown): node is YamlMap =>
  typeof node === 'object' && node !== null && (node as YamlNode).kind === 'map'

export const isSeq = (node: unknown): node is YamlSeq =>
  typeof node === 'object' && node !== null && (node as YamlNode).kind === 'seq'

export const isPair = (node: unknown): node is YamlPair =>
  typeof node === 'object' && node !== null && (node as YamlPair).kind === 'pair'
