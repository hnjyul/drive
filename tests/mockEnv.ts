import type { Env } from "../src/index";

export function createMockEnv(initial: Record<string, string> = {}): Env {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    SETTINGS: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
}

export function createFailingGetEnv(): Env {
  return {
    SETTINGS: {
      get: async () => {
        throw new Error("kv get failed");
      },
      put: async () => {
        throw new Error("kv put failed");
      },
    } as unknown as KVNamespace,
  };
}

export function createFailingPutEnv(initial: Record<string, string> = {}): Env {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    SETTINGS: {
      get: async (key: string) => store.get(key) ?? null,
      put: async () => {
        throw new Error("kv put failed");
      },
    } as unknown as KVNamespace,
  };
}
