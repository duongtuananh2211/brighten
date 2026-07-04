import type { ConfigParams } from "./schema.js";

export interface ConfigVersion {
  readonly version: number;
  readonly params: ConfigParams;
  readonly createdAt: number;
}

export function createConfigVersion(params: ConfigParams, previousVersion: number | undefined, createdAt: number): ConfigVersion {
  return {
    version: (previousVersion ?? 0) + 1,
    params,
    createdAt
  };
}
