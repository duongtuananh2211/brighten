import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";

type ChangeHandler = () => void;

/**
 * Subscribe to Supabase Realtime changes on read tables.
 * Returns a cleanup function to remove all channels.
 *
 * SAFETY (AD-10): Subscription is read-only. No broadcast or write.
 */
export function subscribeToChanges(
  client: SupabaseClient,
  onAnyChange: ChangeHandler,
): () => void {
  const channels: RealtimeChannel[] = [];
  const tables = [
    "suggestions",
    "behavioral_state",
    "drift_metrics",
    "audit_events",
    "override_grants",
  ] as const;

  for (const table of tables) {
    const channel = client
      .channel(`realtime:${table}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table },
        () => {
          onAnyChange();
        },
      )
      .subscribe((status: string) => {
        if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          // Channel will be cleaned up on unmount; fallback polling handles gaps.
        }
      });

    channels.push(channel as unknown as RealtimeChannel);
  }

  return () => {
    for (const ch of channels) {
      client.removeChannel(ch as unknown as RealtimeChannel);
    }
  };
}

/**
 * Fallback polling interval in ms when realtime is unavailable.
 */
export const FALLBACK_POLL_MS = 30_000;
