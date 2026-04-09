import { type OauthFlowsObject, parseOauthFlowsObject } from './oauth-flows';
import { isObject } from 'mjst-helpers/is-object';

export type TypeOauth2Object = {
  type: "oauth2";
  flows: OauthFlowsObject;
};

export const parseTypeOauth2Object = (input: unknown): TypeOauth2Object => {
  if (!isObject(input)) return {} as TypeOauth2Object;
  const _flows = input.flows;
  return {
    ...input,
    type: input?.type === "oauth2" ? input?.type : "oauth2",
    flows: parseOauthFlowsObject(_flows),
  } as unknown as TypeOauth2Object;
}