import type { AccountPort, ClosedTrade, Result } from "@brighten/decision-core";
import { normalizeBalance, normalizeClosedTrades } from "./normalize.js";

// CAUTION (AD-10): This adapter ONLY calls Binance read-only endpoints.
//   GET /fapi/v2/account  – account balance
//   GET /fapi/v1/userTrades – trade history
// No order placement, cancellation, or modification endpoint is ever called.

const source = "adapter.binance_account";
const defaultBaseUrl = "https://fapi.binance.com";

type AccountFetchLike = (url: string, init?: { readonly headers?: Readonly<Record<string, string>> }) => Promise<{ readonly ok: boolean; readonly status: number; readonly json: () => Promise<unknown> }>;

export interface BinanceAccountDeps {
  readonly fetchFn?: AccountFetchLike;
  readonly signer: (queryString: string) => string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly logger?: (message: string, context?: Readonly<Record<string, unknown>>) => void;
}

export function createBinanceAccount(deps: BinanceAccountDeps): AccountPort {
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as unknown as AccountFetchLike);
  const baseUrl = deps.baseUrl ?? defaultBaseUrl;
  const logger = deps.logger ?? (() => undefined);

  return {
    async readBalance() {
      try {
        const queryString = "timestamp=" + String(Date.now());
        const signature = deps.signer(queryString);
        const url = `${baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`;

        const response = await fetchFn(url, {
          headers: { "X-MBX-APIKEY": deps.apiKey }
        });

        if (!response.ok) {
          return fail("http_error", { status: response.status, endpoint: "account" });
        }

        const raw = await response.json();
        return { ok: true, value: normalizeBalance(raw) };
      } catch (error) {
        logger("binance_account_balance_failed", { detail: detail(error) });
        return fail("network_error", { detail: detail(error), endpoint: "account" });
      }
    },

    async readClosedTrades(sinceEpochMillis) {
      try {
        const queryString = "timestamp=" + String(Date.now()) + "&startTime=" + String(sinceEpochMillis) + "&limit=1000";
        const signature = deps.signer(queryString);
        const url = `${baseUrl}/fapi/v1/userTrades?${queryString}&signature=${signature}`;

        const response = await fetchFn(url, {
          headers: { "X-MBX-APIKEY": deps.apiKey }
        });

        if (!response.ok) {
          return fail("http_error", { status: response.status, endpoint: "userTrades" });
        }

        const raw = await response.json();
        const trades: readonly ClosedTrade[] = normalizeClosedTrades(raw);
        return { ok: true, value: trades };
      } catch (error) {
        logger("binance_account_trades_failed", { detail: detail(error) });
        return fail("network_error", { detail: detail(error), endpoint: "userTrades" });
      }
    }
  };
}

function fail(code: string, context: Readonly<Record<string, unknown>>): Result<never> {
  return { ok: false, error: { code, source, context } };
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
