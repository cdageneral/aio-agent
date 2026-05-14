"use client";
import { useEffect, useRef, useState } from "react";
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

      {/* Pulse cards — share the same "X of Y" framing so the math is obvious.
          Card 1: AIO penetration (queries with AIO / total queries).
          Card 2: Citation share — % of queries where the client is cited.
          Card 3: Top brand — leader's citation share, with the leader's name in the label.
          Card 4: Others — non-tracked source share, click to jump to full list. */}
      {(() => {
        const totalKw = latest.total_keywords || 0;
        const clientShare = totalKw ? (client?.aios_acquired ?? 0) / totalKw : 0;
        // Brand-mention share = AIOs where the brand's name appears in the AIO answer text,
        // divided by total queries. Same denominator as the other cards for a consistent X/Y framing.
        const mentionCount = client?.mention_count ?? 0;
        const mentionShare = totalKw ? mentionCount / totalKw : 0;
        const topBrand = ranked[0];
        const topBrandShare = totalKw && topBrand ? topBrand.aios_acquired / totalKw : 0;
        // "Others" = every citation slot going to a non-tracked source (Wikipedia, Reddit, news, industry-but-untracked, etc.)
        const totalSlots = latest.total_citation_slots ?? 0;
        const otherSlots = (latest.share_of_voice ?? [])
          .filter((s: any) => s.kind === "bucket")
          .reduce((acc: number, s: any) => acc + (s.slots ?? 0), 0);
        const othersShare = totalSlots ? otherSlots / totalSlots : 0;
        return (
          <div className="mt-6">
            {/* ── Top row · SERP saturation ──────────────────────────────────
                "How big is the AIO battleground?" Elevated cards because the
                rest of the panel's math only matters if AIOs are happening. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Pulse
                label="Available AIOs"
                value={latest.total_aios_triggered.toLocaleString()}
                sub={`across ${totalKw.toLocaleString()} tracked quer${totalKw === 1 ? "y" : "ies"}`}
                accent="cyan"
                emphasis
                explanation="The raw count of AI Overviews Google is currently surfacing across your tracked keyword universe. This is the absolute size of the AIO battleground — how many actual AIO answers exist for you to potentially be cited in. The bigger this number, the more individual answers you have to engineer your way into."
              />
              <Pulse
                label="AIO Penetration in SERP"
                value={fmtPct(triggerPct)}
                sub={`${latest.total_aios_triggered.toLocaleString()} of ${totalKw.toLocaleString()} queries`}
                accent="cyan"
                emphasis
                explanation="The percentage of your tracked queries where Google is showing an AI Overview. This is how saturated this SERP is — high penetration means AIOs have already reshaped the experience and traditional organic clicks are being substituted for Google's AIO summary. When this number is high, AIO citation strategy isn't optional."
              />
            </div>

            {/* ── Bottom row · Client placement within the battleground ─────
                "Given AIOs are happening, where do you sit?" Five cards at
                normal weight, since they're context to the SERP-level story.
                Acquisition · {client} mirrors Top brand · {leader} so the two
                read as a direct head-to-head comparison. */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
              <Pulse
                label={`Acquisition · ${project.brand_name}`}
                value={fmtPct(clientShare)}
                sub={clientRank === 1 ? "you lead the field" : `you're ${ordinal(clientRank)} of ${ranked.length}`}
                accent="blue"
                explanation={`${project.brand_name}'s AIO acquisition rate — the percentage of tracked queries where your domain is cited as a source inside the AI Overview. Uses the same formula as the Top Brand card so you can compare side by side: the gap between this number and Top Brand's number is the ground you need to make up. When you ARE the top brand, the two cards converge.`}
              />
              <Pulse
                label="Brand mentions"
                value={fmtPct(mentionShare)}
                sub={`${mentionCount} of ${totalKw.toLocaleString()} brand mentions`}
                accent="lime"
                explanation="AIOs where your brand name appears in the answer text, with or without a citation link. A softer signal than Acquisition — Google is talking about you even if you didn't earn the clickable source slot. The gap between this and Acquisition tells you whether to focus on content quality (convert mentions to citations) or topical authority (get into the answer text in the first place)."
              />
              <Pulse
                label="Citation share"
                value={fmtPct(clientShare)}
                sub={`${client?.aios_acquired ?? 0} of ${totalKw.toLocaleString()} citations`}
                accent="blue"
                explanation="The percentage of your tracked queries where your domain was cited as a source inside the AI Overview. Same number as the Acquisition card on the left — this is the generic/template framing for the same metric. Most brands land in the 5–25% range. Above 50% is exceptional and means you're dominating your category."
              />
              <Pulse
                label={`Top brand · ${topBrand?.brand_name ?? "—"}`}
                value={fmtPct(topBrandShare)}
                sub={topBrand?.kind === "client" ? "you lead" : "leads the field"}
                accent="pink"
                explanation="The brand with the highest citation share across this snapshot's AIOs. When you ARE the top brand, this card matches your Acquisition card. When a competitor is on top, this card shows their share and the gap between you and them is how far behind you are. Look at this card and the Acquisition card side-by-side to see your competitive position at a glance."
              />
              <Pulse
                label="Others"
                value={fmtPct(othersShare)}
                sub="view all →"
                accent="amber"
                onClick={() => {
                  if (typeof document !== "undefined") {
                    document.getElementById("section-other-domains")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                explanation="The percentage of AIO citation slots going to sources NOT in your tracked set — Wikipedia, Reddit, news sites, industry sites you haven't added as competitors. High 'Others' means lots of zero-click attention is being captured by sources you might want to add as competitors. Click the card to scroll to the full domain list."
              />
            </div>
          </div>
        );
      })()}

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

function Pulse({
  label, value, sub, accent, onClick, explanation, emphasis = false,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "blue" | "cyan" | "pink" | "amber" | "lime";
  /** When set, the card becomes a button (cursor:pointer, hover state). */
  onClick?: () => void;
  /** When set, an (i) icon appears top-right. Click toggles a popover with this text. */
  explanation?: string;
  /** When true, the card renders larger — bigger value font, more padding, stronger border.
   *  Used by the top-row SERP-saturation cards to make them feel elevated above the placement row. */
  emphasis?: boolean;
}) {
  const accentVar = `var(--accent-${accent})`;
  const accentSoft = `var(--accent-${accent}-soft)`;
  const clickable = !!onClick;
  const [infoOpen, setInfoOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Close the info popover on outside click / Escape — but only while it's open.
  useEffect(() => {
    if (!infoOpen) return;
    function onDocClick(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) setInfoOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setInfoOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [infoOpen]);

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={emphasis ? "rounded-xl p-5" : "rounded-xl p-3"}
      style={{
        position: "relative",
        background: accentSoft,
        border: emphasis ? `1px solid ${accentVar}66` : `1px solid ${accentVar}33`,
        boxShadow: emphasis ? `0 0 0 1px ${accentVar}22, 0 6px 18px rgba(0,0,0,0.25)` : undefined,
        cursor: clickable ? "pointer" : "default",
        transition: "border-color 120ms ease, transform 80ms ease",
      }}
      onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = `${accentVar}99`; } : undefined}
      onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.borderColor = `${accentVar}33`; } : undefined}
    >
      {explanation && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setInfoOpen((v) => !v); }}
            aria-label={`About ${label}`}
            title={`About ${label}`}
            style={{
              position: "absolute",
              top: 7,
              right: 7,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: infoOpen ? `${accentVar}` : "transparent",
              color: infoOpen ? "#06070b" : accentVar,
              border: `1px solid ${accentVar}66`,
              cursor: "pointer",
              fontSize: 11,
              lineHeight: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              opacity: 0.85,
              transition: "background 120ms ease, color 120ms ease, opacity 120ms ease",
              fontFamily: "Georgia, serif",
              fontStyle: "italic",
              fontWeight: 600,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
          >
            i
          </button>
          {infoOpen && (
            <div
              role="tooltip"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                top: 32,
                right: -2,
                width: 280,
                zIndex: 50,
                padding: "10px 12px",
                borderRadius: 10,
                background: "#11151d",
                border: `1px solid ${accentVar}55`,
                boxShadow: "0 8px 20px rgba(0,0,0,0.50)",
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "#d6dbe6",
                fontWeight: 400,
                textAlign: "left",
                textTransform: "none",
                letterSpacing: "normal",
              }}
            >
              <div style={{ fontSize: 10, color: accentVar, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
              {explanation}
            </div>
          )}
        </>
      )}
      <div className={`uppercase tracking-wide font-semibold ${emphasis ? "text-[11px]" : "text-[10px]"}`} style={{ color: accentVar, paddingRight: explanation ? 22 : 0 }}>{label}</div>
      <div className={`font-semibold mt-1 ${emphasis ? "text-4xl" : "text-2xl"}`} style={{ color: "var(--text)", letterSpacing: emphasis ? "-0.025em" : undefined, lineHeight: emphasis ? 1.05 : undefined }}>{value}</div>
      <div className={`muted mt-1 ${emphasis ? "text-[12px]" : "text-[11px]"}`}>{sub}</div>
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
