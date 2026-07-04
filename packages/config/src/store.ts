import { clone, deepFreeze } from "./snapshot.js";
import { validateParams } from "./schema.js";
import { createConfigVersion } from "./version.js";
import type { ConfigParams, Result } from "./schema.js";
import type { ConfigVersion } from "./version.js";

export interface ConfigStore {
  save(params: unknown): Result<ConfigVersion>;
  getByVersion(version: number): ConfigVersion | undefined;
  getLatest(): ConfigVersion | undefined;
}

export interface InMemoryConfigStoreOptions {
  readonly now?: () => number;
}

export class InMemoryConfigStore implements ConfigStore {
  readonly #versions = new Map<number, ConfigVersion>();
  readonly #now: () => number;

  constructor(options: InMemoryConfigStoreOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
  }

  save(params: unknown): Result<ConfigVersion> {
    const validation = validateParams(params);
    if (!validation.ok) {
      return validation;
    }

    const latestVersion = this.getLatest()?.version;
    const configVersion = deepFreeze(
      createConfigVersion(cloneParams(validation.value), latestVersion, this.#now())
    ) as ConfigVersion;

    this.#versions.set(configVersion.version, configVersion);

    return { ok: true, value: configVersion };
  }

  getByVersion(version: number): ConfigVersion | undefined {
    return this.#versions.get(version);
  }

  getLatest(): ConfigVersion | undefined {
    const latestVersion = this.#versions.size;
    return latestVersion === 0 ? undefined : this.#versions.get(latestVersion);
  }
}

function cloneParams(params: ConfigParams): ConfigParams {
  return clone(params);
}
