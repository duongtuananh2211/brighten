import type { ConfigParams } from "./schema.js";
import type { ConfigVersion } from "./version.js";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface ConfigSnapshot {
  readonly version: number;
  readonly params: DeepReadonly<ConfigParams>;
}

export function snapshot(configVersion: ConfigVersion): ConfigSnapshot {
  return deepFreeze({
    version: configVersion.version,
    params: clone(configVersion.params)
  });
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }

  for (const propertyName of Reflect.ownKeys(value)) {
    const propertyValue = (value as Record<PropertyKey, unknown>)[propertyName];
    deepFreeze(propertyValue);
  }

  return Object.freeze(value) as DeepReadonly<T>;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
