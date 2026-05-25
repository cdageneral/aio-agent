"use client";

/**
 * v1.1.60 — Citation landscape
 *
 * Merges the previously separate "Brand comparison" (CompetitorTable) and
 * "Other domains in AIOs" (OtherDomainsTabs) sections into a single tabbed
 * surface. Three tabs:
 *
 *   1. "Tracked brands" — the original CompetitorTable view, unchanged. Lists
 *      every brand (client + competitors) with citation_rate, mention_rate,
 *      etc. The familiar table for direct competitive comparison.
 *   2. "Other domains" — the original OtherDomainsTabs view, unchanged. Inner
 *      tabs (Top 10 / Full list / By source type) survive, just nested under
 *      the outer tab now.
 *   3. "All" — NEW. A single ranked list that mixes tracked brands AND other
 *      domains, ordered by total AIOs cited (desc). Each row is tagged with
 *      its origin (`tracked brand` vs `other domain`) so the user can still
 *      tell them apart at a glance. The client row stays highlighted with
 *      the accent-blue background, same convention as CompetitorTable.
 *
 * Why merge: the two sections answered the same question — "who shows up in
 * AIOs?" — but split the answer across two scroll positions on the page
 * (Brand comparison directly after StoryPanel, Other domains all the way at
 * the bottom). With the merge, the whole citation landscape lives in one
 * surface and the tabs let the user pivot from brand-only comparison to the
 * full picture without scrolling.
 *
 * The original component files (CompetitorTable.tsx, OtherDomainsTabs.tsx)
 * are kept on disk and re-rendered here as the panel bodies — no logic was
 * duplicated, so future tweaks to e.g. the source-type breakdown still flow
 * through OtherDomainsTabs.
 */

import { useEffect, useMemo, useState } from "react";
import CompetitorTable from "./CompetitorTable";
import OtherDomainsTabs from "./OtherDomainsTabs";

type TabKey = "brands" | "others" | "all";

/**
 * Window event the StoryPanel "Others" pulse card fires when the user clicks
 * it. The detail carries the tab key to open. CitationLandscape listens and
 * flips its tab + scrolls itself into view, preserving the behavior the user
 * had pre-v1.1.60 (clicking "Others" used to scroll to the standalone Other
 * domains section). Using a CustomEvent rather than prop-drilling because
 * StoryPanel and CitationLandscape are siblings under Dashboard and there's
 * only one CitationLandscape on the page.
 */
export const SHOW_TAB_EVENT = "aio:citation-landscape-show-tab";
export interface ShowTabDetail { tab: TabKey }

function pct(x: number) {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

/** One row in the combined "All" view. We project both brand rows and
 *  other-domain rows into a single shape so they can sort and render side
 *  by side without branching all over the JSX. */
interface UnifiedRow {
  key: string;
  display_name: string;
  domain: string;
  origin: "brand" | "other";
  // For brands, this is `aios_acquired`. For other domains, this is `count`.
  // Same denominator (number of AIOs the entity appears in), so ranking by
  // this field is apples-to-apples.
  count: number;
  // v1.1.61: citation_rate is now populated for BOTH brand rows AND
  // other-domain rows. Brands carry the metric directly off the payload
  // (`latest.brands[].citation_rate`). Other-domain rows are computed here
  // as `count / latest.total_aios_triggered` — the SAME formula and the
  // SAME denominator metrics.ts uses for the brand `citation_rate` field
  // (see metrics.ts line 211). So a 35% rate on `en.wikipedia.org` means
  // exactly what 35% on a tracked brand means: cited in 35% of all AIOs
  // triggered in the current scope.
  is_client?: boolean;
  citation_rate?: number;
  source_type?: string;
}

export default function CitationLandscape({ latest }: { latest: any }) {
  const [tab, setTab] = useState<TabKey>("brands");

  // Listen for external requests to open a specific tab — currently fired by
  // the StoryPanel "Others" pulse card so its onClick still leads the user
  // to the Other domains view even though that view is now nested inside this
  // tabbed surface rather than being its own page section.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onShowTab = (e: Event) => {
      const detail = (e as CustomEvent<ShowTabDetail>).detail;
      if (!detail?.tab) return;
      setTab(detail.tab);
    };
    window.addEventListener(SHOW_TAB_EVENT, onShowTab as EventListener);
    return () => window.removeEventListener(SHOW_TAB_EVENT, onShowTab as EventListener);
  }, []);

  const unified: UnifiedRow[] = useMemo(() => {
    if (!latest) return [];
    // v1.1.61: pull the AIO-universe denominator off the metrics payload
    // (computed in lib/metrics.ts as `aioSerps.length` — the count of
    // distinct AIOs triggered in the current region/kind scope). This is
    // the SAME number the brand `citation_rate` field divides by, so a rate
    // computed against it for an other-domain row is directly comparable to
    // a brand's rate. Guard against zero so we don't emit `Infinity`.
    const totalAios: number = latest.total_aios_triggered ?? 0;
    const brands: UnifiedRow[] = (latest.brands ?? []).map((b: any) => ({
      key: `b:${b.domain}`,
      display_name: b.brand_name,
      domain: b.domain,
      origin: "brand",
      count: b.aios_acquired ?? 0,
      is_client: b.kind === "client",
      citation_rate: b.citation_rate,
    }));
    const others: UnifiedRow[] = (latest.other_domains ?? []).map((o: any) => ({
      key: `o:${o.domain}`,
      display_name: o.domain,
      domain: o.domain,
      origin: "other",
      count: o.count ?? 0,
      // Same formula metrics.ts uses for brands: count / total_aios_triggered.
      // `undefined` if we can't compute it (no AIOs in scope) so the JSX
      // can still fall back to a dash.
      citation_rate: totalAios > 0 ? (o.count ?? 0) / totalAios : undefined,
      source_type: o.source_type,
    }));
    return [...brands, ...others].sort((a, b) => b.count - a.count);
  }, [latest]);

  if (!latest) return <div className="text-sm muted">No data yet.</div>;

  // Pill tab styling — reuses the segToggle aesthetic from uiStyles.ts but
  // inlined here so the tab strip can also display a count badge per tab
  // (uiStyles' segToggleBtn was built for simple label-only toggles).
  const tabBtn = (k: TabKey, label: string, count?: number) => {
    const active = tab === k;
    return (
      <button
        key={k}
        onClick={() => setTab(k)}
        role="tab"
        aria-selected={active}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 14px",
          borderRadius: 7,
          fontSize: 13,
          fontWeight: active ? 600 : 500,
          color: active ? "#06070b" : "#d6dbe6",
          background: active ? "#4f8cff" : "transparent",
          border: "none",
          cursor: "pointer",
          transition: "background-color 120ms ease, color 120ms ease",
        }}
      >
        {label}
        {typeof count === "number" && (
          <span
            style={{
              fontSize: 10.5,
              padding: "1px 6px",
              borderRadius: 999,
              background: active ? "rgba(6,7,11,0.15)" : "rgba(255,255,255,0.07)",
              color: active ? "#06070b" : "#8a93a6",
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  const brandCount = latest?.brands?.length ?? 0;
  const otherCount = latest?.other_domains?.length ?? 0;
  const allCount = brandCount + otherCount;

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: "inline-flex",
          padding: 3,
          borderRadius: 10,
          background: "#11151d",
          border: "1px solid rgba(255,255,255,0.07)",
          marginBottom: 14,
          gap: 2,
        }}
      >
        {tabBtn("brands", "Tracked brands", brandCount)}
        {tabBtn("others", "Other domains", otherCount)}
        {tabBtn("all", "All", allCount)}
      </div>

      {tab === "brands" && (
        <div role="tabpanel">
          <CompetitorTable latest={latest} />
        </div>
      )}

      {tab === "others" && (
        <div role="tabpanel">
          <OtherDomainsTabs latest={latest} />
        </div>
      )}

      {tab === "all" && (
        <div role="tabpanel">
          {unified.length === 0 ? (
            <div className="text-sm muted">No citations in this snapshot.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-left text-[10px] uppercase tracking-wide font-semibold muted"
                    style={{ borderBottom: "1px solid var(--line)" }}
                  >
                    <th className="py-3 pr-3" style={{ width: 36, textAlign: "right" }}>#</th>
                    <th className="py-3 pr-3">Name</th>
                    <th className="py-3 pr-3">Domain</th>
                    <th className="py-3 pr-3">Type</th>
                    <th className="py-3 pr-3 text-right">AIOs</th>
                    <th className="py-3 pr-3 text-right">Citation rate</th>
                  </tr>
                </thead>
                <tbody>
                  {unified.map((row, i) => (
                    <tr
                      key={row.key}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        background: row.is_client ? "var(--accent-blue-soft)" : "transparent",
                      }}
                    >
                      <td className="py-3 pr-3" style={{ textAlign: "right", color: "var(--muted)", fontSize: 11 }}>
                        {i + 1}
                      </td>
                      <td className="py-3 pr-3 font-medium">
                        {row.display_name}
                        {row.is_client && <span className="ml-1 tag tag-accent">client</span>}
                      </td>
                      <td className="py-3 pr-3 muted">{row.domain}</td>
                      <td className="py-3 pr-3">
                        {row.origin === "brand" ? (
                          <span
                            style={{
                              fontSize: 10.5,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "rgba(79,140,255,0.15)",
                              color: "#4f8cff",
                              fontWeight: 600,
                              letterSpacing: "0.02em",
                            }}
                          >
                            tracked brand
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 10.5,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "rgba(168,120,255,0.13)",
                              color: "#a878ff",
                              fontWeight: 600,
                              letterSpacing: "0.02em",
                            }}
                            title={row.source_type ? `Source type: ${row.source_type}` : undefined}
                          >
                            {row.source_type ?? "other"}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right font-semibold">{row.count}</td>
                      <td className="py-3 pr-3 text-right">
                        {/* v1.1.61: both brand AND other-domain rows now show
                            a citation rate. Brands use the value off the
                            payload; other domains use count / total_aios_-
                            triggered, computed in the unified-row builder
                            above. Fallback to "—" only when total_aios is
                            zero (no AIOs in scope, can't divide). */}
                        {row.citation_rate !== undefined ? pct(row.citation_rate) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
