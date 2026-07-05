"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "../lib/supabase/client";
import { subscribeToChanges, FALLBACK_POLL_MS } from "../lib/realtime";

interface LiveContextValue {
  /** Epoch millis of last data update (via realtime or poll). */
  readonly lastUpdatedAt: number | null;
  /** Whether realtime is currently connected. */
  readonly connected: boolean;
  /** Manual refresh trigger. */
  readonly refresh: () => void;
}

const LiveContext = createContext<LiveContextValue>({
  lastUpdatedAt: null,
  connected: false,
  refresh: () => undefined,
});

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}

interface LiveProviderProps {
  readonly children: ReactNode;
}

export function LiveProvider({ children }: LiveProviderProps) {
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const refresh = useCallback(() => {
    setLastUpdatedAt(Date.now());
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    try {
      const client = createClient();
      setConnected(true);

      // Setup realtime subscription
      cleanup = subscribeToChanges(client, () => {
        setLastUpdatedAt(Date.now());
        setConnected(true);
      });

      // Fallback polling
      pollRef.current = setInterval(() => {
        setLastUpdatedAt(Date.now());
      }, FALLBACK_POLL_MS);
    } catch {
      // No Supabase config yet (dev/CI) — silently skip realtime
      setConnected(false);
    }

    return () => {
      if (cleanup !== undefined) cleanup();
      if (pollRef.current !== undefined) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  return (
    <LiveContext.Provider value={{ lastUpdatedAt, connected, refresh }}>
      {children}
    </LiveContext.Provider>
  );
}
