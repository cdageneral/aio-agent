/**
 * Safe JSON fetch helper. Replaces the common `await fetch(...).json()` pattern
 * that throws "Unexpected end of JSON input" when the server returned an empty
 * body or HTML.
 *
 * Always returns an object — `{ ok, data, error, status }`. Never throws on
 * parse errors. Empty bodies, HTML 500 pages, and timeouts all become
 * human-readable error strings.
 */

export interface FetchJsonResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function fetchJson<T = any>(
  url: string,
  init?: RequestInit,
): Promise<FetchJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: e?.message ?? "Network error — could not reach the server" };
  }

  const text = await res.text();
  // Empty body — usually a 500/503 with no payload. Surface the status code
  // so the user knows the server crashed rather than seeing a JSON parse error.
  if (!text) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: res.ok
        ? "Server returned an empty response"
        : `Server error ${res.status} — empty response body. The route probably threw an exception. Check Vercel logs, env vars, and that the database schema is initialized.`,
    };
  }

  // Try JSON. If parsing fails, the body is probably an HTML error page;
  // include a short excerpt for diagnostics rather than the full HTML.
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    const excerpt = text.slice(0, 200).replace(/\s+/g, " ").trim();
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `Server error ${res.status} — non-JSON response: ${excerpt}${text.length > 200 ? "…" : ""}`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      error: (data && (data.error || data.message)) || `Request failed with status ${res.status}`,
    };
  }

  return { ok: true, status: res.status, data, error: null };
}
