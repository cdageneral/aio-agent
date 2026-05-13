"use client";

function pct(x: number | undefined | null) {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}
function deltaPct(x: number | undefined | null) {
  if (x == null || !Number.isFinite(x) || x === 0) return null;
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)}%`;
}
function deltaPoints(x: number | undefined | null) {
  if (x == null || !Number.isFinite(x) || x === 0) return null;
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)} pts`;
}

/**
 * KPI strip — six cards in the user-specified order:
 *   1. AIOs triggered (market segment)
 *   2. AIOs triggered (organic footprint)
 *   3. AIOs acquired (count)
 *   4. Acquired rate (% — same as citation rate)
 *   5. Total brand mentions (count)
 *   6. Brand mention rate (%)
 * Each card carries its own accent color via data-accent.
 */
export default function KpiCards({ latest, growth, project }: { latest: any; growth: any; project: any }) {
  if (!latest) {
    return (
      <div className="surface p-5 text-sm muted">
        No snapshot yet. Add competitors, define a keyword universe, then click <strong className="font-semibold text-white">Run refresh</strong>.
      </div>
    );
  }
  const client = latest.brands.find((b: any) => b.kind === "client");
  const clientGrowth = growth?.brands?.find((b: any) => b.brand_name === client?.brand_name);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi
        accent="cyan"
        label="AIOs triggered — market"
        value={latest.total_aios_triggered}
        sub={`of ${latest.total_keywords} keywords`}
        delta={growth ? deltaPct(growth.total_aios) : null}
      />
      <Kpi
        accent="amber"
        label="AIOs triggered — footprint"
        value={latest.total_aios_triggered_organic}
        sub={`of ${latest.total_keywords_organic} organic kws`}
        delta={growth ? deltaPct(growth.total_aios_organic) : null}
      />
      <Kpi
        accent="blue"
        label="AIOs acquired"
        value={client?.aios_acquired ?? 0}
        sub={project.brand_name}
        delta={clientGrowth ? deltaPct(clientGrowth.aios_acquired) : null}
      />
      <Kpi
        accent="blue"
        label="Acquired rate"
        value={pct(client?.citation_rate)}
        sub={`${pct(client?.citation_rate_organic)} on footprint`}
        delta={clientGrowth ? deltaPoints(clientGrowth.citation_rate_delta) : null}
      />
      <Kpi
        accent="pink"
        label="Total brand mentions"
        value={client?.mention_count ?? 0}
        sub={`${project.brand_name} named in AIO text`}
        delta={null}
      />
      <Kpi
        accent="pink"
        label="Brand mention rate"
        value={pct(client?.mention_rate)}
        sub="mentions ÷ AIOs triggered"
        delta={clientGrowth ? deltaPoints(clientGrowth.mention_rate_delta) : null}
      />
    </div>
  );
}

function Kpi({
  accent, label, value, sub, delta,
}: { accent: "blue" | "cyan" | "amber" | "lime" | "pink"; label: string; value: any; sub?: string; delta?: string | null }) {
  return (
    <div className="kpi" data-accent={accent}>
      <div className="kpi-label">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="kpi-value">{value}</div>
        {delta && (
          <div className={`kpi-delta ${delta.startsWith("-") ? "kpi-delta-neg" : "kpi-delta-pos"}`}>{delta}</div>
        )}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
