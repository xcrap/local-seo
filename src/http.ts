// Read at most this many bytes of a response body. Real HTML pages are far
// smaller; the cap stops a linked PDF/ZIP/video from being buffered into memory.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function charsetFromContentType(contentType: string) {
  const match = /charset=([^;]+)/i.exec(contentType || "");
  return match ? match[1].trim().replace(/["']/g, "").toLowerCase() : "";
}

async function readCappedBody(response: Response, contentType: string) {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer()).slice(0, MAX_BODY_BYTES);
    return decodeBody(buffer, contentType);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const merged = new Uint8Array(Math.min(total, MAX_BODY_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.length) break;
    const slice = chunk.subarray(0, merged.length - offset);
    merged.set(slice, offset);
    offset += slice.length;
  }
  return decodeBody(merged, contentType);
}

function decodeBody(bytes: Uint8Array, contentType: string) {
  // Prefer the declared charset; fall back to a meta charset for HTML that
  // omits it in the header, then UTF-8. Guards against mojibake on legacy sites.
  let charset = charsetFromContentType(contentType);
  if (!charset) {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048));
    const metaMatch = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head);
    if (metaMatch) charset = metaMatch[1].toLowerCase();
  }
  try {
    return new TextDecoder(charset || "utf-8", { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

export async function fetchText(url: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LocalSEO/0.1 (+https://localhost)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      contentType,
      contentLength: Number(response.headers.get("content-length") || 0) || null,
      contentEncoding: response.headers.get("content-encoding") || "",
      xRobotsTag: response.headers.get("x-robots-tag") || "",
      retryAfter: response.headers.get("retry-after") || "",
      text: await readCappedBody(response, contentType),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(url: string, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "LocalSEO/0.1 (+https://localhost)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      data: text ? JSON.parse(text) : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
