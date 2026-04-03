export type BindingsPulsarServerObject = {
  /** The pulsar tenant. If omitted, 'public' MUST be assumed. */
  tenant?: string;
  /** The version of this binding. If omitted, 'latest' MUST be assumed. */
  bindingVersion?: "0.1.0";
};