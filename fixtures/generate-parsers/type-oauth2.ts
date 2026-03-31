import { type OauthFlowsObject, parseOauthFlowsObject } from './oauth-flows';
import { isObject } from './helpers/is-object';

export type TypeOauth2Object = {
  type: "oauth2";
  flows: OauthFlowsObject;
};

export const parseTypeOauth2Object = (input: unknown): TypeOauth2Object => {
  if (!isObject(input)) return {
        flows: parseOauthFlowsObject(undefined),
      };
  const _flows = input.flows;
  return {
    ...input,
    ...(input.type !== undefined && { type: input?.type === "oauth2" ? input?.type : "oauth2" }),
    flows: parseOauthFlowsObject(_flows),
  };
}