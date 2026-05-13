"use client";
import { useMemo, useState } from "react";
import { ghostBtnStyle } from "./uiStyles";

const SOURCE_TYPES = ["wikipedia", "reddit", "news", "industry", "other"] as const;

export default function OtherDomainsTabs({ latest }: { latest: any }) {
  const [tab, setTab] = useState<"top" | "all" | "type">("top");
  const [page, setPage] = useState(0);
  const [filterType, setFilterType] = useState<string>("all");

  const others: { domain: string; count: number; source_type: string }[] = latest?.other_domains ?? [];
  const breakdown: Record<string, number> = latest?.source_type_breakdown ?? {};

  const filtered = useMemo(() => {
    if (filterType === "all") return others;
    return others.filter((o) => o.source_type === filterType);
  }, [others, filterType]);

  if (!latest) return <div className="text-sm text-gray-500">No data yet.</div>;
  if (others.length === 0) return <div className="text-sm text-gray-500">No other domains cited in this snapshot.</div>;

  const top = others.slice(0, 10);
  const pageSize = 20;
  const pages = Math.ceil(filtered.length / pageSize);
  const slice = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const tabBtn = (k: typeof tab, label: string) => (
    <button
      onClick={() => { setTab(k); setPage(0); }}
      className="text-xs px-3 py-1.5 rounded-md"
      style={tab === k
        ? { background: "var(--accent-blue-soft)", color: "var(--accent-blue)", border: "1px solid var(--accent-blue)" }
        : { background: "var(--surface-2)", color: "var(--muted)", border: "1px solid var(--line)" }}
    >{label}</button>
  );

  const ACCENT: Record<string, string> = { wikipedia: "blue", reddit: "amber", news: "cyan", industry: "lime", other: "pink" };

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {tabBtn("top", "Top 10")}
        {tabBtn("all", `Full list (${others.length})`)}
        {tabBtn("type", "By source type")}
      </div>

      {tab === "top" && (
        <ul className="text-sm">
          {top.map((o) => (
            <li key={o.domain} className="flex items-center justify-between py-2.5" style={{ borderBottom: "1px solid var(--line)" }}>
              <div>
                <div className="font-medium">{o.domain}</div>
                <div className="text-xs muted">{o.source_type}</div>
              </div>
              <div className="text-sm">{o.count} AIO{o.count === 1 ? "" : "s"}</div>
            </li>
          ))}
        </ul>
      )}

      {tab === "all" && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <select className="input w-auto text-xs" value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(0); }}>
              <option value="all">All types</option>
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="text-xs muted">Showing {slice.length} of {filtered.length}</div>
          </div>
          <ul className="text-sm">
            {slice.map((o) => (
              <li key={o.domain} className="flex items-center justify-between py-2" style={{ borderBottom: "1px solid var(--line)" }}>
                <div>
                  <div className="font-medium">{o.domain}</div>
                  <div className="text-xs muted">{o.source_type}</div>
                </div>
                <div className="text-sm">{o.count}</div>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex justify-between items-center mt-3 text-xs">
              <button style={ghostBtnStyle(page === 0)} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span className="muted">Page {page + 1} / {pages}</span>
              <button style={ghostBtnStyle(page >= pages - 1)} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {tab === "type" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {SOURCE_TYPES.map((t) => {
            const a = ACCENT[t] ?? "blue";
            return (
              <div key={t} className="rounded-xl p-4" style={{ background: `var(--accent-${a}-soft)`, border: `1px solid var(--accent-${a})33` }}>
                <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: `var(--accent-${a})` }}>{t}</div>
                <div className="text-2xl font-semibold mt-1">{breakdown[t] ?? 0}</div>
                <div className="text-xs muted mt-1">citations</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
