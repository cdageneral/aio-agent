"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RegionSelector, { RegionMode, regionsForMode } from "@/components/RegionSelector";
import { primaryBtnStyle } from "@/components/uiStyles";
import { fetchJson } from "@/lib/fetch-json";

/**
 * New project wizard — v1.1.63.
 *
 * Single-step form: URL, brand name, aliases, region, and an optional
 * keyword file upload (CSV or plain text). Auto-detect / segment detection
 * has been removed — keywords drive everything now.
 *
 * On submit:
 *   1. POST /api/projects  → creates the project
 *   2. If a keyword file was provided, parse it and POST the keywords to
 *      /api/projects/:id/keywords (source = "manual")
 *   3. Navigate to the project dashboard
 */

/** Parse a CSV or plain-text keyword file.
 *  - Accepts CSV (first column = keyword) or one-per-line plain text.
 *  - Skips blank lines and obvious header rows ("keyword", "keywords", "Keyword").
 *  - Handles basic quoted CSV values.
 */
function parseKeywordFile(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const keywords: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Extract first column (handles simple CSV quoting)
    let first: string;
    if (line.startsWith('"')) {
      const m = line.match(/^"([^"]*)"/);
      first = m ? m[1].trim() : line.replace(/"/g, "").split(",")[0].trim();
    } else {
      first = line.split(",")[0].trim();
    }
    if (!first) continue;
    // Skip header rows
    if (/^keywords?$/i.test(first)) continue;
    keywords.push(first);
  }
  return keywords;
}

export default function NewProjectPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [clientUrl, setClientUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [aliases, setAliases] = useState("");
  const [region, setRegion] = useState<RegionMode>("us");
  const [kwFile, setKwFile] = useState<File | null>(null);
  const [kwCount, setKwCount] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setKwFile(file);
    setKwCount(null);
    if (!file) return;
    // Preview the keyword count without blocking
    file.text().then((text) => {
      const kws = parseKeywordFile(text);
      setKwCount(kws.length);
    });
  }

  function clearFile() {
    setKwFile(null);
    setKwCount(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);

    try {
      // 1. Create the project
      const createRes = await fetchJson<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_url: clientUrl,
          brand_name: brand,
          brand_aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
          regions: regionsForMode(region),
        }),
      });
      if (!createRes.ok || !createRes.data?.project) {
        throw new Error(createRes.error ?? "Failed to create project");
      }
      const projectId = createRes.data.project.id;

      // 2. Upload keywords if a file was provided
      if (kwFile) {
        const text = await kwFile.text();
        const keywords = parseKeywordFile(text);
        if (keywords.length > 0) {
          await fetch(`/api/projects/${projectId}/keywords`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              method: "manual",
              keywords,
            }),
          });
          // Non-fatal if keyword upload fails — user can add from dashboard
        }
      }

      // 3. Go to dashboard
      router.push(`/projects/${projectId}`);
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">New project</h1>
      <p className="text-sm muted mt-1">
        Enter the client's details and upload a keyword list to get started. You can add more keywords and competitors from the dashboard at any time.
      </p>

      {err && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(255,100,100,0.08)", border: "1px solid rgba(255,100,100,0.25)", color: "#ff6464", fontSize: 13 }}>
          {err}
        </div>
      )}

      <form onSubmit={onSubmit} className="surface p-6 mt-6 space-y-5">

        {/* URL */}
        <div>
          <label className="label">Client website</label>
          <input
            className="input text-base font-semibold"
            placeholder="https://www.yourdomain.com"
            value={clientUrl}
            onChange={(e) => setClientUrl(e.target.value)}
            required
            style={{ fontSize: 15 }}
          />
        </div>

        {/* Brand + aliases */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Brand name</label>
            <input
              className="input"
              placeholder="Your brand name"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Brand aliases <span className="muted" style={{ fontWeight: 400 }}>(optional, comma-separated)</span></label>
            <input
              className="input"
              placeholder="Brand Inc., Brand Co."
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
            />
          </div>
        </div>

        {/* Region */}
        <div>
          <label className="label">Region</label>
          <RegionSelector value={region} onChange={setRegion} />
          <p className="text-xs muted mt-2">US, Canada, or both. You can change this from the dashboard after creation.</p>
        </div>

        {/* Keyword file upload */}
        <div>
          <label className="label">
            Keyword list <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
          </label>

          {!kwFile ? (
            <label
              htmlFor="kw-file-input"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "28px 20px",
                borderRadius: 10,
                border: "1.5px dashed rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.02)",
                cursor: "pointer",
                transition: "border-color 150ms",
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file && fileInputRef.current) {
                  // Programmatically set for preview count; actual upload uses kwFile state
                  setKwFile(file);
                  file.text().then((text) => setKwCount(parseKeywordFile(text).length));
                }
              }}
            >
              <i className="ti ti-file-upload" style={{ fontSize: 24, color: "#5a6478" }} aria-hidden="true"></i>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#d6dbe6" }}>Drop a file or click to browse</div>
                <div className="text-xs muted mt-1">CSV or plain text · one keyword per line · first column used for CSV</div>
              </div>
              <input
                ref={fileInputRef}
                id="kw-file-input"
                type="file"
                accept=".csv,.txt,.tsv,text/plain,text/csv"
                style={{ display: "none" }}
                onChange={onFileChange}
              />
            </label>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(182,245,59,0.06)",
                border: "1px solid rgba(182,245,59,0.25)",
              }}
            >
              <i className="ti ti-file-check" style={{ fontSize: 20, color: "#b6f53b", flexShrink: 0 }} aria-hidden="true"></i>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f4f6fb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kwFile.name}</div>
                <div className="text-xs muted">
                  {kwCount !== null ? `${kwCount.toLocaleString()} keyword${kwCount === 1 ? "" : "s"} detected` : "Parsing…"}
                </div>
              </div>
              <button
                type="button"
                onClick={clearFile}
                title="Remove file"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, borderRadius: 6,
                  background: "transparent", border: "1px solid rgba(255,255,255,0.10)",
                  color: "#8a93a6", cursor: "pointer", flexShrink: 0,
                }}
              >
                <i className="ti ti-x" style={{ fontSize: 13 }} aria-hidden="true"></i>
              </button>
            </div>
          )}
          <p className="text-xs muted mt-2">
            You can also add and manage keywords from the dashboard after creation.
          </p>
        </div>

        {/* Submit */}
        <div className="flex justify-end">
          <button type="submit" disabled={submitting} style={primaryBtnStyle(submitting)}>
            {submitting
              ? (kwFile ? "Creating & uploading keywords…" : "Creating…")
              : (kwFile && kwCount
                  ? `Create project with ${kwCount.toLocaleString()} keyword${kwCount === 1 ? "" : "s"} →`
                  : "Create project →")}
          </button>
        </div>
      </form>
    </div>
  );
}
