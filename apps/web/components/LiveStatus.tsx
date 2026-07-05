"use client";

import { useLive } from "./LiveProvider";

export function LiveStatus() {
  const { lastUpdatedAt, connected } = useLive();

  return (
    <div className="flex items-center gap-3 mt-1">
      {/* Connection indicator */}
      <span
        className="inline-flex items-center gap-1.5 text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{
            background: connected
              ? "var(--color-primary)"
              : "var(--color-halt)",
          }}
        />
        {connected ? "Live" : "Offline"}
      </span>

      {/* Last updated */}
      {lastUpdatedAt !== null && (
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Updated {new Date(lastUpdatedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
