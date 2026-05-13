"use client";
import { RegionMode } from "./RegionSelector";

/**
 * The "story" panel. Synthesizes a plain-English narrative from the latest
 * snapshot + growth deltas so the dashboard isn't just a dump of numbers —
 * it tells a SERP-impact story.
 *
 * Pure render — no fetches. All data comes from the metrics payload.
 */
export default function StoryPanel({
  project,
  latest,
  growth,
  region,
}: {
  project: any;
  latest: any | null;
  growth: any | null;
  region: RegionMode;
}) {
  if (!latest) {
    return (
      <div className="surface p-8">
        <div className="text-sm muted">No snapshots yet — run a refresh to see how AI Overviews are reshaping your SERP.</div>
      </div>
    );
  }

  const client = latest.brands.find((b: any) => b.kind === "client");
  const competitors = latest.brands.filter((b: any) => b.kind === "competitor");
  const ranked = [...latest.brands].sort((a: any, b: any) => b.citation_rate - a.citation_rate);
  const clientRank = ranked.findIndex((b: any) => b.kind === "client") + 1;
  const leader = ranked[0];
  const trailing = clientRank > 1 ? ranked[clientRank - 2] : null;

  const triggerPct = latest.total_keywords > 0 ? latest.total_aios_triggered / latest.total_keywords : 0;
  const clientGrowth = growth?.brands?.find((b: any) => b.brand_name === client?.brand_name);
  const leaderGrowth = growth?.brands?.find((b: any) => b.brand_name === leader?.brand_name);

  // Source-type story: how much zero-click attention is going to non-brand sources.
  const stb = latest.source_type_breakdown ?? {};
  const totalCites = (stb.wikipedia ?? 0) + (stb.reddit ?? 0) + (stb.news ?? 0) + (stb.industry ?? 0) + (stb.other ?? 0);
  const nonBrandShare = totalCites > 0 ? ((stb.wikipedia ?? 0) + (stb.reddit ?? 0)) / totalCites : 0;
  const regionLabel = region === "us" ? "US" : region === "ca" ? "Canada" : "US + Canada";

  const headline =
    triggerPct >= 0.5
      ? "AIOs are dominating this SERP"
      : triggerPct >= 0.3
      ? "AIOs are reshaping a meaningful slice of this SERP"
      : "AIOs are emerging in this SERP";

  const winningLine =
    clientRank === 1
      ? `${project.brand_name} is leading citation share at ${fmtPct(client.citation_rate)}.`
      : `${leader.brand_name} leads at ${fmtPct(leader.citation_rate)}; ${project.brand_name} is ${ordinal(clientRank)} at ${fmtPct(client?.citation_rate ?? 0)}.`;

  const trendLine =
    clientGrowth != null
      ? clientGrowth.aios_acquired > 0
        ? `Citation count is ${fmtSigned(clientGrowth.aios_acquired)} vs the prior snapshot.`
        : clientGrowth.aios_acquired < 0
        ? `Citation count is ${fmtSigned(clientGrowth.aios_acquired)} — losing ground vs prior snapshot.`
        : "Acquisition is flat vs the prior snapshot."
      : "Run another refresh to start trending growth.";

  // Cluster-driven topical narrative. Only computed when clustering has run.
  // Strongest = highest client citation rate (with ≥3 AIOs to avoid noise).
  // Weakest = lowest client citation rate (also with ≥3 AIOs).
  // Battleground = cluster with the most AIO citations regardless of who's winning.
  const clusters = (latest.clusters ?? []) as any[];
  const meaningfulClusters = clusters.filter((c) => c.aio_count >= 3);
  const strongest = meaningfulClusters.length
    ? [...meaningfulClusters].sort((a, b) => b.client_citation_rate - a.client_citation_rate)[0]
    : null;
  const weakest = meaningfulClusters.length
    ? [...meaningfulClusters].sort((a, b) => a.client_citation_rate - b.client_citation_rate)[0]
    : null;
  const battleground = clusters.length
    ? [...clusters].sort((a, b) => b.aio_count - a.aio_count)[0]
    : null;
  // Don't surface the same cluster twice in the narrative.
  const showWeakest = weakest && weakest.name !== strongest?.name;
  const showBattleground = battleground && battleground.name !== strongest?.name && battleground.name !== weakest?.name;

  return (
    <div className="surface p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="tag tag-accent">SERP impact · {regionLabel}</span>
        <span className="text-xs dim">Snapshot from {new Date(latest.ran_at ?? Date.now()).toLocaleDateString()}</span>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight" style={{ letterSpacing: "-0.015em" }}>{headline}</h2>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--text)" }}>
        Across <strong className="font-semibold">{latest.total_keywords.toLocaleString()}</strong> tracked queries,{" "}
        Google is showing an AI Overview on <span style={{ color: "var(--accent-cyan)" }} className="font-semibold">{fmtPct(triggerPct)}</span>{" "}
        of them — <strong className="font-semibold">{latest.total_aios_triggered.toLocaleString()}</strong> AIOs in this snapshot.{" "}
        On the client's <span style={{ color: "var(--accent-amber)" }} className="font-semibold">organic footprint</span> ({latest.total_keywords_organic.toLocaleString()} ranked terms),{" "}
        AIOs appear on <span style={{ color: "var(--accent-amber)" }} className="font-semibold">{fmtPct(latest.total_keywords_organic ? latest.total_aios_triggered_organic / latest.total_keywords_organic : 0)}</span>.
      </p>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--text)" }}>
        {winningLine}{" "}
        {trailing && clientRank > 1 && (
          <>
            <span className="muted">Closest threat below you is</span>{" "}
            <strong className="font-semibold">{trailing.brand_name}</strong> at {fmtPct(trailing.citation_rate)}.{" "}
          </>
        )}
        <span style={{ color: clientGrowth?.aios_acquired >= 0 ? "var(--accent-lime)" : "var(--accent-red)" }} className="font-semibold">
          {trendLine}
        </span>
      </p>
      <p className="mt-3 text-[15px] leading-relaxed muted">
        Of every citation slot inside these AIOs, <span style={{ color: "var(--accent-pink)" }} className="font-semibold">{fmtPct(nonBrandShare)}</span>{" "}
        belongs to <strong className="font-semibold" style={{ color: "var(--text)" }}>Wikipedia or Reddit</strong> — zero-click authority that's eating attention nobody is monetizing.{" "}
        Owning a slot in those AIOs is the new front of the click-vs-no-click fight.
      </p>

      {(strongest || weakest || battleground) && (
        <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--text)" }}>
          <span className="muted">By topic — </span>
          {strongest && (
            <>
              strongest in <strong className="font-semibold" style={{ color: "var(--accent-lime)" }}>{strongest.name}</strong> at{" "}
              <strong className="font-semibold">{fmtPct(strongest.client_citation_rate)}</strong> citation rate
              {strongest.top_winner?.kind === "client" ? " (you lead this cluster)" : ""}.{" "}
            </>
          )}
          {showWeakest && (
            <>
              Weakest in <strong className="font-semibold" style={{ color: "var(--accent-red)" }}>{weakest!.name}</strong> at just{" "}
              <strong className="font-semibold">{fmtPct(weakest!.client_citation_rate)}</strong>
              {weakest!.top_winner && weakest!.top_winner.kind === "competitor" && (
                <> — <strong className="font-semibold">{weakest!.top_winner.brand_name}</strong> owns this topic at {fmtPct(weakest!.top_winner.citation_rate)}</>
              )}
              .{" "}
            </>
          )}
          {showBattleground && (
            <>
              Biggest battleground is <strong className="font-semibold" style={{ color: "var(--accent-cyan)" }}>{battleground!.name}</strong>{" "}
              with <strong className="font-semibold">{battleground!.aio_count}</strong> AIOs in play.
            </>
          )}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
        <Pulse label="AIO penetration" value={fmtPct(triggerPct)} sub={`of ${latest.total_keywords.toLocaleString()} queries`} accent="cyan" />
        <Pulse label={`${project.brand_name} acquired`} value={String(client?.aios_acquired ?? 0)} sub={fmtPct(client?.citation_rate ?? 0) + " citation rate"} accent="blue" />
        <Pulse label={`vs ${leader?.brand_name ?? "leader"}`} value={fmtPct(leader?.citation_rate ?? 0)} sub={leader?.brand_name === project.brand_name ? "you" : "leads the field"} accent="pink" />
        {latest.volume ? (
          <Pulse
            label="AIO market size"
            value={fmtPct(latest.volume.aio_volume_share)}
            sub={`${(latest.volume.aio_volume / 1000).toFixed(1)}k / ${(latest.volume.total_volume / 1000).toFixed(1)}k searches`}
            accent="amber"
          />
        ) : (
          <Pulse label="Non-brand share" value={fmtPct(nonBrandShare)} sub="Wikipedia + Reddit" accent="amber" />
        )}
      </div>

      {latest.volume && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: "rgba(255,184,70,0.08)", border: "1px solid rgba(255,184,70,0.22)", fontSize: 12.5 }}>
          <strong style={{ color: "#ffb846" }}>Volume-weighted:</strong>{" "}
          {project.brand_name} owns{" "}
          <strong style={{ color: "#f4f6fb" }}>
            {fmtPct(latest.volume.brand_weighted_share.find((b: any) => b.kind === "client")?.weighted_share ?? 0)}
          </strong>{" "}
          of AIO-triggered search volume.
          <span className="muted"> Volume known on {fmtPct(latest.volume.coverage)} of the universe.</span>
        </div>
      )}
    </div>
  );
}

function Pulse({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: "blue" | "cyan" | "pink" | "amber" | "lime" }) {
  const accentVar = `var(--accent-${accent})`;
  const accentSoft = `var(--accent-${accent}-soft)`;
  return (
    <div className="rounded-xl p-3" style={{ background: accentSoft, border: `1px solid ${accentVar}33` }}>
      <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: accentVar }}>{label}</div>
      <div className="text-2xl font-semibold mt-1" style={{ color: "var(--text)" }}>{value}</div>
      <div className="text-[11px] muted mt-1">{sub}</div>
    </div>
  );
}

function fmtPct(x: number) { if (!Number.isFinite(x)) return "—"; return `${(x * 100).toFixed(1)}%`; }
function fmtSigned(x: number) { const s = x > 0 ? "+" : ""; return `${s}${x}`; }
function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
