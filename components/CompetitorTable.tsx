"use client";

function pct(x: number) {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

export default function CompetitorTable({ latest }: { latest: any }) {
  if (!latest) return <div className="text-sm muted">No data yet.</div>;
  const rows = [...latest.brands].sort((a: any, b: any) => b.citation_rate - a.citation_rate);
  // v1.1.65: "Citation rate (footprint)" column removed. In real-world
  // snapshots the value rendered as 0.0% for every tracked brand because
  // the per-brand `total_aios_triggered_organic` denominator (AIOs the
  // brand actually ranked organically for) is only populated when the
  // refresh pipeline captures organic position alongside AIO citations —
  // which it currently doesn't on the standard SerpAPI path. Until the
  // organic-footprint capture lands as a refresh-side feature, the column
  // was visual noise and the user asked for it gone. The
  // `citation_rate_organic` field is still emitted by lib/metrics.ts and
  // still carried on the metrics payload — only the table column is
  // dropped. Re-adding the column later is a JSX-only change.
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide font-semibold muted" style={{ borderBottom: "1px solid var(--line)" }}>
            <th className="py-3 pr-3">Brand</th>
            <th className="py-3 pr-3">Domain</th>
            <th className="py-3 pr-3 text-right">AIOs acquired</th>
            <th className="py-3 pr-3 text-right">Citation slots</th>
            <th className="py-3 pr-3 text-right">Citation rate (brands)</th>
            <th className="py-3 pr-3 text-right">Mention rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b: any) => (
            <tr key={b.domain} style={{
              borderBottom: "1px solid var(--line)",
              background: b.kind === "client" ? "var(--accent-blue-soft)" : "transparent",
            }}>
              <td className="py-3 pr-3 font-medium">
                {b.brand_name} {b.kind === "client" && <span className="ml-1 tag tag-accent">client</span>}
              </td>
              <td className="py-3 pr-3 muted">{b.domain}</td>
              <td className="py-3 pr-3 text-right">{b.aios_acquired}</td>
              <td className="py-3 pr-3 text-right">{b.citation_slots}</td>
              <td className="py-3 pr-3 text-right font-semibold">{pct(b.citation_rate)}</td>
              <td className="py-3 pr-3 text-right">{pct(b.mention_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
