"use client";

/**
 * v1.1.37: live progress display for an in-flight SerpAPI refresh.
 *
 * Renders a sticky-ish strip above the dashboard sections showing:
 *   - A green progress bar (white background → lime fill)
 *   - "1,234 / 6,436 keywords processed (19%)"
 *   - Real-time AIO hit count and error count
 *   - Elapsed time + rate (kws / sec) + ETA
 *   - A stall warning when the server hasn't made progress in a while
 *
 * Pure presentational — all polling logic lives in the Dashboard component.
 */

export interface RefreshProgressData {
  total: number;
  done: number;
  aios_so_far: number;
  failed_so_far: number;
  pct: number;
  elapsed_sec: number;
  stalled: boolean;
  status: "pending" | "running" | "complete" | "failed";
  error?: string | null;
}

function fmtSecs(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function RefreshProgress({ data }: { data: RefreshProgressData }) {
  const { total, done, aios_so_far, failed_so_far, pct, elapsed_sec, stalled, status, error } = data;
  const pctRounded = Math.round(pct * 100);
  const rate = elapsed_sec > 0 ? done / elapsed_sec : 0;
  const remaining = Math.max(0, total - done);
  const etaSec = rate > 0 ? Math.round(remaining / rate) : 0;

  // Color the bar by status: green for running/complete, red for failed, amber when stalled.
  const barColor = status === "failed" || stalled
    ? "#ff6464"
    : status === "complete"
      ? "#b6f53b"
      : "#25e0ce";

  return (
    <section
      aria-live="polite"
      style={{
        background: "rgba(11,13,18,0.85)",
        border: `1px solid ${stalled || status === "failed" ? "rgba(255,100,100,0.40)" : "rgba(37,224,206,0.30)"}`,
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
      }}
    >
      {/* Header row: label + status pill + percentage */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <i
            className={`ti ${status === "running" ? "ti-loader-2" : status === "complete" ? "ti-circle-check" : status === "failed" ? "ti-circle-x" : "ti-clock"}`}
            style={{
              fontSize: 16,
              color: barColor,
              animation: status === "running" && !stalled ? "spin 1.2s linear infinite" : undefined,
            }}
            aria-hidden="true"
          />
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f4f6fb", letterSpacing: "0.02em" }}>
            {status === "complete" ? "Refresh complete"
              : status === "failed" ? "Refresh failed"
              : stalled ? "Refresh stalled"
              : "Refresh in progress"}
          </div>
          {status === "running" && !stalled && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(37,224,206,0.12)", color: "#25e0ce", fontWeight: 600 }}>
              live
            </span>
          )}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: barColor, fontVariantNumeric: "tabular-nums" }}>
          {pctRounded}%
        </div>
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={pctRounded}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: "100%",
          height: 8,
          borderRadius: 999,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: `${Math.max(2, pctRounded)}%`,
            height: "100%",
            background: barColor,
            transition: "width 600ms ease-out",
            borderRadius: 999,
          }}
        />
      </div>

      {/* Counts row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, fontVariantNumeric: "tabular-nums" }}>
        <Stat label="Processed" value={`${fmtInt(done)} / ${fmtInt(total)}`} color="#f4f6fb" />
        <Stat label="AIOs found" value={fmtInt(aios_so_far)} color="#b6f53b" />
        <Stat label="Errors" value={fmtInt(failed_so_far)} color={failed_so_far > 0 ? "#ff6464" : "#8a93a6"} />
        <Stat label="Elapsed" value={fmtSecs(elapsed_sec)} color="#d6dbe6" />
        <Stat label="Rate" value={rate > 0 ? `${rate.toFixed(1)} kw/s` : "—"} color="#d6dbe6" />
        <Stat label="ETA" value={status === "running" && rate > 0 && remaining > 0 ? fmtSecs(etaSec) : "—"} color="#d6dbe6" />
      </div>

      {/* Stall / failure callout */}
      {(stalled || status === "failed") && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 9,
            background: "rgba(255,100,100,0.08)",
            border: "1px solid rgba(255,100,100,0.30)",
            fontSize: 12,
            color: "#ffb1b1",
            lineHeight: 1.5,
          }}
        >
          {status === "failed" ? (
            <>
              <strong style={{ color: "#ff6464" }}>Refresh failed.</strong>{" "}
              {error ? <span style={{ color: "#d6dbe6" }}>{error}</span> : "Check Vercel function logs for the underlying error."}
            </>
          ) : (
            <>
              <strong style={{ color: "#ff6464" }}>No progress in the last minute.</strong>{" "}
              <span style={{ color: "#d6dbe6" }}>
                The serverless function was almost certainly killed by Vercel&apos;s execution time limit
                ({total > 1000 ? "expected for large universes" : "even on Pro"}). The snapshot is stuck in
                &lsquo;running&rsquo;. Click Run refresh again to start a fresh snapshot, or wait — we&apos;re working on
                background-job execution to fix this properly.
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#8a93a6", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
