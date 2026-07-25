/**
 * The slice of Lynx's Element PAPI this host drives.
 *
 * Lynx injects these as globals into the engine's JavaScript context. They are
 * declared here as an explicit type — rather than reached for as ambient
 * globals — so the host can take them as an argument. That keeps the adapter
 * testable off-device: a fake PAPI is just an object literal, and the whole
 * mapping can be verified without an engine anywhere in sight.
 *
 * This is deliberately the smallest possible subset. Lynx exposes a great deal
 * more (component IDs, datasets, computed styles, element swapping), none of
 * which a framework with no virtual tree ever needs.
 */
export type LynxElementApi = {
  /**
   * Creates an element. The second parameter is the unique ID of the Lynx
   * component that owns it; this framework does not use Lynx's component
   * system — it owns the whole tree itself — so it always passes `0`.
   */
  __CreateElement: (tag: string, parentComponentUniqueId: number, info?: object) => LynxElement
  __SetAttribute: (element: LynxElement, name: string, value: unknown) => void
  __GetAttributes: (element: LynxElement) => Record<string, unknown>
  __SetInlineStyles: (element: LynxElement, styles: Record<string, string> | string) => void
  __AddInlineStyle: (element: LynxElement, name: string, value: unknown) => void
  __SetClasses: (element: LynxElement, classes: string) => void
  __AppendElement: (parent: LynxElement, child: LynxElement) => void
  __InsertElementBefore: (parent: LynxElement, child: LynxElement, anchor: LynxElement) => void
  __RemoveElement: (parent: LynxElement, child: LynxElement) => void
  __GetParent: (element: LynxElement) => LynxElement | null
  __GetChildren: (element: LynxElement) => LynxElement[]
  __FirstElement: (element: LynxElement) => LynxElement | null
  __NextElement: (element: LynxElement) => LynxElement | null
  /**
   * Registers a handler.
   *
   * Only ONE listener is kept per type-and-name pair — registering another
   * overwrites the first, and passing `null` removes it. The host works around
   * that by registering a single dispatcher per event name and fanning out to
   * its own handler set, so callers get the usual add-many semantics.
   */
  __AddEvent: (element: LynxElement, type: string, name: string, listener: ((event: unknown) => void) | null) => void
  /** Commits pending mutations. Nothing appears on screen until this runs. */
  __FlushElementTree: (element?: LynxElement) => void
}

/** An opaque Lynx element handle. The engine owns whatever this actually is. */
export type LynxElement = { readonly __lynxElement: unique symbol }

/**
 * Reads the PAPI off the global object.
 *
 * The functions are injected as bare globals rather than exported from a
 * module, so there is nothing to import — collecting them into one object here
 * is what lets everything downstream treat them as an ordinary dependency.
 */
export const globalLynxApi = (): LynxElementApi => globalThis as unknown as LynxElementApi
