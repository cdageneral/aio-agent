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
  kindFilter = "all",
  onKindFilterChange,
}: {
  project: any;
  latest: any | null;
  growth: any | null;
  region: RegionMode;
  /** v1.1.28: branded/non-branded scope, controlled by Dashboard so it can
   *  also flow into QuickWinsPanel + KeywordExplorer. The toggle UI lives
   *  inside this panel (above the pulse cards) — it was buried in the
   *  top-of-page area in v1.1.27 and people missed it. */
  kindFilter?: "all" | "branded" | "non_branded";
  onKindFilterChange?: (v: "all" | "branded" | "non_branded") => void;
}) {
  if (!latest) {
    return (
      <div className="surface p-8">
        <div className="text-sm muted">No snapshots yet — run a refresh to see how AI Overviews are reshaping your SERP.</div>
      </div>
    );
  }

  const client = latest.brands.find((b: any) => b.kind === "client");
  const ranked = [...latest.brands].sort((a: any, b: any) => b.citation_rate - a.citation_rate);
  const clientRank = ranked.findIndex((b: any) => b.kind === "client") + 1;
  const leader = ranked[0];
  // v1.1.30: fix the misnamed "trailing" lookup. ranked[clientRank-2] was the
  // brand AHEAD of the client (the leader), not behind — so the prose read
  // "Closest threat below you is [the leader]" which was wrong. We don't need
  // this concept anymore for the new CMO-tone copy; the runner-up is only
  // mentioned when the client IS the leader.
  const runnerUp = clientRank === 1 ? ranked[1] : null;

  const triggerPct = latest.total_keywords > 0 ? latest.total_aios_triggered / latest.total_keywords : 0;
  const clientCiteRate = client?.citation_rate ?? 0;
  const clientGrowth = growth?.brands?.find((b: any) => b.brand_name === client?.brand_name);

  // Source-type story: how much zero-click attention is going to non-brand sources.
  const stb = latest.source_type_breakdown ?? {};
  const totalCites = (stb.wikipedia ?? 0) + (stb.reddit ?? 0) + (stb.news ?? 0) + (stb.industry ?? 0) + (stb.other ?? 0);
  const nonBrandShare = totalCites > 0 ? ((stb.wikipedia ?? 0) + (stb.reddit ?? 0)) / totalCites : 0;
  const regionLabel = region === "us" ? "US" : region === "ca" ? "Canada" : "US + Canada";

  // v1.1.42: trend pill now uses citation_rate_delta (absolute pt change in
  // citation rate vs the prior snapshot) instead of aios_acquired (growth
  // rate of raw acquired count). Same direction, much clearer label — "+1.7
  // pts vs prior snapshot" is unambiguous; "8% vs prior" forced the user to
  // mentally translate a rate-of-change of a count.
  //
  // v1.1.30 history: the metrics layer used to pass growth.brands[i].aios_acquired
  // as a raw decimal (e.g. -0.0625), which rendered as a decimal in the
  // prose. v1.1.42 replaces this with the absolute pt delta the metrics
  // route already computes (citation_rate_delta) and falls back to the
  // legacy growth-rate field on older payloads.
  const clientDeltaPts: number | null =
    typeof clientGrowth?.citation_rate_delta === "number"
      ? clientGrowth.citation_rate_delta // absolute, e.g. 0.017 = 1.7 pts
      : null;
  // 0.5 pt threshold — below this is noise.
  const hasTrendSignal = clientDeltaPts !== null && Math.abs(clientDeltaPts) >= 0.005;

  const headline =
    triggerPct >= 0.5
      ? "AIOs dominate this SERP"
      : triggerPct >= 0.3
      ? "AIOs are reshaping this SERP"
      : "AIOs are emerging in this SERP";

  // Gap-to-leader in percentage points, rounded to 1 decimal.
  const gapPt = clientRank > 1 && leader ? (leader.citation_rate - clientCiteRate) * 100 : 0;

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
    <div
      style={{
        background: "#0c0f15",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* v1.1.31: framed executive-briefing layout. Tightly disciplined color
          palette — white for numbers, muted gray for labels and supporting
          context, ONE accent (cyan) used only on the section eyebrow strip
          and the trend arrow when negative/positive. The four insights map
          1:1 to what a CMO wants to know in 5 seconds:
            • How "infected" is the SERP? (coverage %)
            • Where do I stand vs the top competitor? (position)
            • Where do I dominate? (strongest cluster)
            • Where am I losing? (weakest cluster) */}

      {/* Header strip — eyebrow + timestamp */}
      <div
        style={{
          padding: "12px 22px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          background: "rgba(255,255,255,0.015)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#25e0ce", display: "inline-block" }} aria-hidden="true"></span>
          <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#d6dbe6" }}>
            Executive summary
          </span>
          <span style={{ fontSize: 11, color: "#5a6478" }}>·</span>
          <span style={{ fontSize: 11, color: "#8a93a6" }}>SERP impact · {regionLabel}</span>
        </div>
        <span style={{ fontSize: 11, color: "#5a6478" }}>
          Snapshot · {new Date(latest.ran_at ?? Date.now()).toLocaleDateString()}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "22px 22px 18px" }}>
        <h2
          style={{
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "-0.015em",
            color: "#f4f6fb",
            margin: 0,
          }}
        >
          {headline}
        </h2>

        {/* 4-insight grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginTop: 18,
          }}
        >
          {/* v1.1.41: AIO coverage card removed at user request. The headline
              ("AIOs dominate / are reshaping / are emerging") is still driven
              by `triggerPct`, so the same signal is conveyed at-a-glance
              without duplicating the number in a tile. */}

          {/* Position vs top competitor */}
          <InsightBlock
            label="Your position"
            value={fmtPct(clientCiteRate)}
            context={
              clientRank === 1
                ? `${project.brand_name} leads${runnerUp ? ` — ${runnerUp.brand_name} ${fmtPct(runnerUp.citation_rate)}` : ""}`
                : `${ordinal(clientRank)} behind ${leader.brand_name} (${fmtPct(leader.citation_rate)})${gapPt >= 0.1 ? ` — ${gapPt.toFixed(1)} pt gap` : ""}`
            }
            trend={
              hasTrendSignal
                ? {
                    direction: (clientDeltaPts ?? 0) >= 0 ? "up" : "down",
                    // v1.1.42: absolute pt change vs prior snapshot. Rounded
                    // to 1 decimal — "+1.7 pts" reads cleaner than "+1.685 pts"
                    // and stops the pill from getting wider on noisy data.
                    label: `${Math.abs((clientDeltaPts ?? 0) * 100).toFixed(1)} pts vs prior snapshot`,
                  }
                : undefined
            }
          />

          {/* 3 · Strongest cluster */}
          {strongest ? (
            <InsightBlock
              label="Strongest cluster"
              value={strongest.name}
              valueSize="md"
              context={
                strongest.top_winner?.kind === "client"
                  ? `${fmtPct(strongest.client_citation_rate)} citation rate — you lead`
                  : `${fmtPct(strongest.client_citation_rate)} citation rate`
              }
            />
          ) : (
            <InsightBlock
              label="Strongest cluster"
              value="—"
              context="Cluster the keywords to populate"
            />
          )}

          {/* 4 · Weakest cluster */}
          {showWeakest ? (
            <InsightBlock
              label="Weakest cluster"
              value={weakest!.name}
              valueSize="md"
              context={
                weakest!.top_winner && weakest!.top_winner.kind === "competitor"
                  ? `${fmtPct(weakest!.client_citation_rate)} — ${weakest!.top_winner.brand_name} leads at ${fmtPct(weakest!.top_winner.citation_rate)}`
                  : `${fmtPct(weakest!.client_citation_rate)} citation rate`
              }
            />
          ) : strongest ? (
            <InsightBlock
              label="Biggest battleground"
              value={battleground?.name ?? "—"}
              valueSize="md"
              context={battleground ? `${battleground.aio_count} AIOs in play` : ""}
            />
          ) : (
            <InsightBlock
              label="Weakest cluster"
              value="—"
              context="Cluster the keywords to populate"
            />
          )}
        </div>
      </div>

      {/* v1.1.31: padded section that wraps everything below the briefing card.
          The outer box has no padding, so the toggle / pulse cards / volume
          strip each need this wrapper to keep their horizontal alignment. */}
      <div style={{ padding: "0 22px 22px" }}>

      {/* v1.1.28: relocated branded vs non-branded scope toggle. Sits directly
          above the pulse cards so the user reads "what's the scope?" → adjusts
          → sees the cards re-populate. Visually heavier than the v1.1.27 strip
          (header + explainer + larger touch targets) so it can't be missed. */}
      {onKindFilterChange && (latest.total_keywords_branded + latest.total_keywords_non_branded) > 0 && (
        <ScopeToggle
          value={kindFilter}
          onChange={onKindFilterChange}
          branded={latest.total_keywords_branded}
          nonBranded={latest.total_keywords_non_branded}
        />
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

      </div>{/* /v1.1.31 padded section */}

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

/**
 * v1.1.31: single block inside the 4-insight executive briefing grid.
 *
 * Layout: eyebrow label · large value (white) · short context line (muted) ·
 * optional trend chip (red ↓ / green ↑). One accent color (cyan) is used
 * only for the dot indicator inside the trend chip — body text stays
 * white/muted to keep the briefing readable as a single visual unit.
 */
function InsightBlock({
  label,
  value,
  context,
  valueSize = "lg",
  trend,
}: {
  label: string;
  value: string;
  context: string;
  valueSize?: "lg" | "md";
  trend?: { direction: "up" | "down"; label: string };
}) {
  const valueFont = valueSize === "lg" ? 28 : 17;
  const valueLineHeight = valueSize === "lg" ? 1.1 : 1.3;
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.07)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minHeight: 110,
      }}
    >
      <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "#8a93a6" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: valueFont,
          fontWeight: 500,
          color: "#f4f6fb",
          letterSpacing: valueSize === "lg" ? "-0.02em" : "-0.01em",
          lineHeight: valueLineHeight,
          // Keep cluster names from overflowing the box on small screens.
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
        <div style={{ fontSize: 12, color: "#8a93a6", lineHeight: 1.45 }}>
          {context}
        </div>
        {trend && (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              padding: "2px 7px",
              borderRadius: 999,
              background: trend.direction === "up" ? "rgba(182,245,59,0.12)" : "rgba(255,100,100,0.12)",
              color: trend.direction === "up" ? "#b6f53b" : "#ff6464",
              border: `1px solid ${trend.direction === "up" ? "rgba(182,245,59,0.35)" : "rgba(255,100,100,0.35)"}`,
              whiteSpace: "nowrap",
            }}
          >
            {trend.direction === "up" ? "↑" : "↓"} {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}
function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * v1.1.28: prominent branded/non-branded scope selector.
 *
 * Visual hierarchy: section header → 1-line explainer → three pill buttons
 * sized large enough to be the natural eye-catching element above the pulse
 * cards. Active state uses the brand-accent color + a soft glow ring so the
 * selection is obvious even at a glance.
 *
 * Counts always reflect the FULL keyword universe (not the filtered slice) —
 * the metrics layer guarantees this.
 */
function ScopeToggle({
  value,
  onChange,
  branded,
  nonBranded,
}: {
  value: "all" | "branded" | "non_branded";
  onChange: (v: "all" | "branded" | "non_branded") => void;
  branded: number;
  nonBranded: number;
}) {
  const total = branded + nonBranded;
  const options: { id: "all" | "branded" | "non_branded"; label: string; sub: string; count: number; accent: string }[] = [
    { id: "all",         label: "All keywords", sub: "Combined view",   count: total,       accent: "#8a93a6" },
    { id: "non_branded", label: "Non-branded",  sub: "Generic queries", count: nonBranded,  accent: "#25e0ce" },
    { id: "branded",     label: "Branded",      sub: "Brand queries",   count: branded,     accent: "#a878ff" },
  ];

  return (
    <div
      style={{
        marginTop: 18,
        padding: "16px 18px",
        borderRadius: 12,
        background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01))",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "#ffb846" }}>
            Scope · view by query type
          </div>
          <div style={{ fontSize: 13, color: "#8a93a6", marginTop: 3, lineHeight: 1.5 }}>
            Branded queries inflate citation rates because you already rank #1 organically. Toggle to non-branded to see where AIO is actually competing for clicks.
          </div>
        </div>
        {value !== "all" && (
          <div style={{ fontSize: 11.5, color: "#ffb846", background: "rgba(255,184,70,0.10)", padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(255,184,70,0.35)", whiteSpace: "nowrap" }}>
            Filtered view active
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              type="button"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                padding: "12px 14px",
                borderRadius: 10,
                fontFamily: "inherit",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 140ms ease, border-color 140ms ease, transform 80ms ease",
                background: active ? `${o.accent}1f` : "rgba(20,24,32,0.55)",
                color: active ? o.accent : "#d6dbe6",
                border: active ? `1.5px solid ${o.accent}` : "1px solid rgba(255,255,255,0.10)",
                boxShadow: active ? `0 0 0 3px ${o.accent}22, 0 4px 16px ${o.accent}1a` : "none",
              }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.25)"; }}
              onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.10)"; }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em" }}>{o.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: active ? `${o.accent}33` : "rgba(255,255,255,0.06)",
                    color: active ? o.accent : "#8a93a6",
                  }}
                >
                  {o.count.toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: active ? `${o.accent}cc` : "#5a6478", marginTop: 1 }}>
                {o.sub}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
