/**
 * Pure metric calculators. All inputs are already-fetched snapshot rows from
 * Postgres — these functions never call the network.
 *
 * Definitions (locked 2026-05-12):
 *   - Total AIOs triggered (organic footprint): count of keywords in the
 *       client's organic-ranking universe whose SERP showed an AIO.
 *   - Total AIOs triggered (market level): count across the full universe
 *       (organic + market + manual + seed) whose SERP showed an AIO.
 *   - Total AIOs acquired (per brand): count of keywords whose AIO cites the
 *       brand domain at least once.
 *   - Citation rate (per brand) = brand AIOs acquired / total AIOs triggered.
 *   - Brand mention rate (per brand) = # AIOs whose answer text contains the
 *       brand name (case-insensitive, word-bounded) / total AIOs triggered.
 *   - Growth rate = (current_value - previous_value) / previous_value.
 *
 * "Other" domains: every citation domain that isn't the client and isn't a
 * tracked competitor — surfaced as Top-10 / full long-tail / source-type bucket.
 */

import { domainMatches, normalizeDomain } from "./domain";
import { classifyDomain, SourceType } from "./classify";

export interface SerpResultRow {
  id: string;
  keyword: string;
  country: string;
  has_aio: boolean;
  aio_text: string | null;
  source: "organic" | "market" | "manual" | "seed" | null;
  monthly_volume?: number | null;
  cluster_label?: string | null;
}

export interface CitationRow {
  serp_result_id: string;
  position: number;
  domain: string;
  url: string;
  title: string | null;
}

export interface BrandSpec {
  brand_name: string;
  brand_aliases: string[];
  domain: string;
  kind: "client" | "competitor";
}

export interface BrandMetrics {
  brand_name: string;
  domain: string;
  kind: "client" | "competitor";
  aios_acquired: number;        // AIOs where the brand's domain is cited at least once
  citation_slots: number;       // total citation slots owned across all AIOs
  citation_rate: number;        // aios_acquired / total_aios_triggered_market
  citation_rate_organic: number;// aios_acquired_within_organic / total_aios_triggered_organic
  mention_count: number;        // AIOs whose answer text contains the brand name
  mention_rate: number;         // mention_count / total_aios_triggered_market
}

export interface SovSlice {
  label: string;            // brand name OR "Wikipedia" / "Reddit" / "News" / "Other"
  kind: "client" | "competitor" | "bucket";
  domain?: string;          // present for tracked brands only
  slots: number;            // citation slots
  share: number;            // slots / total_slots
}

export interface SnapshotMetrics {
  total_keywords: number;
  total_keywords_organic: number;
  total_aios_triggered: number;
  total_aios_triggered_organic: number;
  brands: BrandMetrics[];
  /** Domains that aren't the client or a tracked competitor, ranked by citation count. */
  other_domains: { domain: string; count: number; source_type: SourceType }[];
  source_type_breakdown: Record<SourceType, number>;
  /** Share of citation slots across tracked brands + source-type buckets. Sums to 1. */
  share_of_voice: SovSlice[];
  total_citation_slots: number;
  /** Volume-weighted metrics. Only meaningful when ≥1 keyword has a monthly_volume value. */
  volume?: {
    coverage: number;                          // % of keywords with a known volume (0-1)
    total_volume: number;                      // sum of monthly_volume across the universe
    aio_volume: number;                        // sum of monthly_volume where AIO triggered
    aio_volume_share: number;                  // aio_volume / total_volume — the "AIO market size"
    brand_weighted_share: { brand_name: string; kind: "client"|"competitor"; weighted_share: number }[]; // share of AIO volume each brand is cited on
  };
  /** Per-topic-cluster aggregation. Empty when keywords haven't been clustered yet. */
  clusters: ClusterMetrics[];
}

export interface ClusterMetrics {
  name: string;
  keyword_count: number;
  aio_count: number;            // # of keywords in cluster that triggered AIO
  aio_penetration: number;      // aio_count / keyword_count
  total_citation_slots: number; // total citation slots in this cluster's AIOs
  client_aios_acquired: number; // # AIOs where client is cited (within cluster)
  client_citation_rate: number; // client_aios_acquired / aio_count
  top_winner: { brand_name: string; kind: "client" | "competitor"; aios_acquired: number; citation_rate: number } | null;
  brand_shares: { brand_name: string; kind: "client" | "competitor"; slots: number; share: number }[]; // tracked-brand SOV within cluster
  /** Full share-of-voice for this cluster — tracked brands plus non-brand source-type buckets. Same shape as the global SnapshotMetrics.share_of_voice. */
  share_of_voice: SovSlice[];
}

/** Build a case-insensitive word-boundary regex that matches any alias. */
function brandMentionRegex(brand: BrandSpec): RegExp {
  const names = [brand.brand_name, ...(brand.brand_aliases ?? [])]
    .filter(Boolean)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (names.length === 0) return /(?!.*)/; // matches nothing
  return new RegExp(`\\b(${names.join("|")})\\b`, "i");
}

export function computeSnapshotMetrics(
  serps: SerpResultRow[],
  citationsBySerpId: Map<string, CitationRow[]>,
  brands: BrandSpec[],
  opts: { regions?: string[] } = {},
): SnapshotMetrics {
  // Optional region filter — if provided, restrict the universe to those countries.
  const regionFilter = opts.regions && opts.regions.length > 0 ? new Set(opts.regions.map((r) => r.toLowerCase())) : null;
  const scoped = regionFilter ? serps.filter((s) => regionFilter.has(s.country.toLowerCase())) : serps;
  const total_keywords = scoped.length;
  const total_keywords_organic = scoped.filter((s) => s.source === "organic").length;
  const aioSerps = scoped.filter((s) => s.has_aio);
  const total_aios_triggered = aioSerps.length;
  const total_aios_triggered_organic = aioSerps.filter((s) => s.source === "organic").length;

  const brandMetrics: BrandMetrics[] = brands.map((b) => {
    const re = brandMentionRegex(b);
    let aios_acquired = 0;
    let aios_acquired_organic = 0;
    let citation_slots = 0;
    let mention_count = 0;

    for (const serp of aioSerps) {
      const cites = citationsBySerpId.get(serp.id) ?? [];
      const owned = cites.filter((c) => domainMatches(c.domain, b.domain));
      if (owned.length > 0) {
        aios_acquired += 1;
        citation_slots += owned.length;
        if (serp.source === "organic") aios_acquired_organic += 1;
      }
      if (serp.aio_text && re.test(serp.aio_text)) {
        mention_count += 1;
      }
    }

    return {
      brand_name: b.brand_name,
      domain: b.domain,
      kind: b.kind,
      aios_acquired,
      citation_slots,
      citation_rate: total_aios_triggered ? aios_acquired / total_aios_triggered : 0,
      citation_rate_organic: total_aios_triggered_organic
        ? aios_acquired_organic / total_aios_triggered_organic
        : 0,
      mention_count,
      mention_rate: total_aios_triggered ? mention_count / total_aios_triggered : 0,
    };
  });

  // Other-domains rollup
  const trackedDomains = new Set(brands.map((b) => normalizeDomain(b.domain)));
  const counter = new Map<string, number>();
  for (const serp of aioSerps) {
    const cites = citationsBySerpId.get(serp.id) ?? [];
    // Count each domain once per AIO (so a single AIO with two same-domain refs counts as 1).
    const seen = new Set<string>();
    for (const c of cites) {
      const d = normalizeDomain(c.domain);
      if (!d) continue;
      if (trackedDomains.has(d)) continue;
      if (seen.has(d)) continue;
      seen.add(d);
      counter.set(d, (counter.get(d) ?? 0) + 1);
    }
  }
  const trackedList = Array.from(trackedDomains);
  const other_domains = Array.from(counter.entries())
    .map(([domain, count]) => ({
      domain,
      count,
      source_type: classifyDomain(domain, { trackedDomains: trackedList }),
    }))
    .sort((a, b) => b.count - a.count);

  const source_type_breakdown: Record<SourceType, number> = {
    wikipedia: 0, reddit: 0, news: 0, industry: 0, other: 0,
  };
  for (const o of other_domains) source_type_breakdown[o.source_type] += o.count;

  // ----- Share of voice -----
  // Total citation slots across all AIOs in scope.
  let total_citation_slots = 0;
  for (const serp of aioSerps) total_citation_slots += (citationsBySerpId.get(serp.id) ?? []).length;
  // Non-tracked slots per source-type bucket.
  let nonTrackedByBucket: Record<SourceType, number> = { wikipedia: 0, reddit: 0, news: 0, industry: 0, other: 0 };
  const trackedDomainSet = new Set(brands.map((b) => normalizeDomain(b.domain)));
  for (const serp of aioSerps) {
    const cites = citationsBySerpId.get(serp.id) ?? [];
    for (const c of cites) {
      const d = normalizeDomain(c.domain);
      if (!d || trackedDomainSet.has(d)) continue;
      const t = classifyDomain(d, { trackedDomains: Array.from(trackedDomainSet) });
      nonTrackedByBucket[t] += 1;
    }
  }

  const share_of_voice: SovSlice[] = [
    ...brandMetrics.map((b) => ({
      label: b.brand_name,
      kind: b.kind,
      domain: b.domain,
      slots: b.citation_slots,
      share: total_citation_slots ? b.citation_slots / total_citation_slots : 0,
    })),
    ...(["wikipedia", "reddit", "news", "industry", "other"] as SourceType[])
      .filter((t) => nonTrackedByBucket[t] > 0)
      .map((t) => ({
        label: t === "wikipedia" ? "Wikipedia" : t === "reddit" ? "Reddit" : t.charAt(0).toUpperCase() + t.slice(1),
        kind: "bucket" as const,
        slots: nonTrackedByBucket[t],
        share: total_citation_slots ? nonTrackedByBucket[t] / total_citation_slots : 0,
      })),
  ];

  // ----- Volume-weighted metrics -----
  // Only meaningful when at least one keyword in scope has a volume value.
  const withVolume = scoped.filter((s) => typeof s.monthly_volume === "number" && (s.monthly_volume as number) > 0);
  let volume: SnapshotMetrics["volume"] = undefined;
  if (withVolume.length > 0) {
    const total_volume = withVolume.reduce((acc, s) => acc + (s.monthly_volume ?? 0), 0);
    const aio_volume = withVolume.filter((s) => s.has_aio).reduce((acc, s) => acc + (s.monthly_volume ?? 0), 0);
    const brand_weighted_share = brands.map((b) => {
      let won_volume = 0;
      for (const serp of aioSerps) {
        if (!serp.monthly_volume) continue;
        const cites = citationsBySerpId.get(serp.id) ?? [];
        if (cites.some((c) => domainMatches(c.domain, b.domain))) {
          won_volume += serp.monthly_volume;
        }
      }
      return { brand_name: b.brand_name, kind: b.kind, weighted_share: aio_volume ? won_volume / aio_volume : 0 };
    });
    volume = {
      coverage: scoped.length > 0 ? withVolume.length / scoped.length : 0,
      total_volume,
      aio_volume,
      aio_volume_share: total_volume ? aio_volume / total_volume : 0,
      brand_weighted_share,
    };
  }

  // ----- Per-cluster metrics -----
  // Group keywords by cluster_label, then for each cluster recompute the same
  // headline numbers (AIO penetration, client citation rate, brand SOV, top
  // winner). Keywords without a cluster_label land in the "Unclustered" bucket.
  const clusters: ClusterMetrics[] = (() => {
    if (!scoped.some((s) => s.cluster_label)) return []; // skip if nothing's clustered yet
    const byCluster = new Map<string, SerpResultRow[]>();
    for (const s of scoped) {
      const label = s.cluster_label ?? "Unclustered";
      const arr = byCluster.get(label) ?? [];
      arr.push(s);
      byCluster.set(label, arr);
    }
    const out: ClusterMetrics[] = [];
    for (const [name, rows] of byCluster.entries()) {
      const aiosInCluster = rows.filter((r) => r.has_aio);
      let totalSlots = 0;
      for (const r of aiosInCluster) totalSlots += (citationsBySerpId.get(r.id) ?? []).length;

      // Brand stats within this cluster.
      const brandShares = brands.map((b) => {
        let slots = 0;
        let acquired = 0;
        for (const r of aiosInCluster) {
          const cites = citationsBySerpId.get(r.id) ?? [];
          const owned = cites.filter((c) => domainMatches(c.domain, b.domain));
          if (owned.length > 0) acquired += 1;
          slots += owned.length;
        }
        return {
          brand_name: b.brand_name,
          kind: b.kind,
          slots,
          share: totalSlots ? slots / totalSlots : 0,
          aios_acquired: acquired,
          citation_rate: aiosInCluster.length ? acquired / aiosInCluster.length : 0,
        };
      });

      const client = brandShares.find((b) => b.kind === "client");
      const ranked = [...brandShares].sort((a, b) => b.citation_rate - a.citation_rate);
      const winner = ranked.find((b) => b.aios_acquired > 0) ?? null;

      // Non-tracked citation slots within this cluster, bucketed by source type.
      // Mirrors the global SOV computation but scoped to aiosInCluster.
      const localNonTrackedByBucket: Record<SourceType, number> = { wikipedia: 0, reddit: 0, news: 0, industry: 0, other: 0 };
      for (const r of aiosInCluster) {
        const cites = citationsBySerpId.get(r.id) ?? [];
        const seen = new Set<string>();
        for (const c of cites) {
          const d = normalizeDomain(c.domain);
          if (!d || trackedDomainSet.has(d)) continue;
          // Count each non-tracked domain once per AIO so the bucket totals
          // match the slot count semantics used elsewhere.
          if (seen.has(d)) continue;
          seen.add(d);
          const t = classifyDomain(d, { trackedDomains: Array.from(trackedDomainSet) });
          localNonTrackedByBucket[t] += 1;
        }
      }
      // Recompute totalSlots to match the unique-per-AIO counting used for
      // non-tracked, so the SOV percentages add up cleanly.
      const trackedSlots = brandShares.reduce((acc, b) => acc + b.slots, 0);
      const bucketSlots = (Object.keys(localNonTrackedByBucket) as SourceType[]).reduce((acc, k) => acc + localNonTrackedByBucket[k], 0);
      const sovTotal = trackedSlots + bucketSlots;

      const cluster_sov: SovSlice[] = [
        ...brandShares.map((b) => ({
          label: b.brand_name,
          kind: b.kind,
          domain: brands.find((br) => br.brand_name === b.brand_name)?.domain,
          slots: b.slots,
          share: sovTotal ? b.slots / sovTotal : 0,
        })),
        ...(["wikipedia", "reddit", "news", "industry", "other"] as SourceType[])
          .filter((t) => localNonTrackedByBucket[t] > 0)
          .map((t) => ({
            label: t === "wikipedia" ? "Wikipedia" : t === "reddit" ? "Reddit" : t.charAt(0).toUpperCase() + t.slice(1),
            kind: "bucket" as const,
            slots: localNonTrackedByBucket[t],
            share: sovTotal ? localNonTrackedByBucket[t] / sovTotal : 0,
          })),
      ];

      out.push({
        name,
        keyword_count: rows.length,
        aio_count: aiosInCluster.length,
        aio_penetration: rows.length ? aiosInCluster.length / rows.length : 0,
        total_citation_slots: sovTotal,
        client_aios_acquired: client?.aios_acquired ?? 0,
        client_citation_rate: client?.citation_rate ?? 0,
        top_winner: winner ? { brand_name: winner.brand_name, kind: winner.kind, aios_acquired: winner.aios_acquired, citation_rate: winner.citation_rate } : null,
        brand_shares: brandShares.map((b) => ({ brand_name: b.brand_name, kind: b.kind, slots: b.slots, share: b.share })),
        share_of_voice: cluster_sov,
      });
    }
    // Sort by AIO count desc so the biggest topic surfaces first.
    out.sort((a, b) => b.aio_count - a.aio_count || b.keyword_count - a.keyword_count);
    return out;
  })();

  return {
    total_keywords,
    total_keywords_organic,
    total_aios_triggered,
    total_aios_triggered_organic,
    brands: brandMetrics,
    other_domains,
    source_type_breakdown,
    share_of_voice,
    total_citation_slots,
    volume,
    clusters,
  };
}

/** Growth rate between two snapshots' values. Returns 0 when prior is 0. */
export function growthRate(current: number, previous: number): number {
  if (!previous) return 0;
  return (current - previous) / previous;
}
