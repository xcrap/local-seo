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
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      contentType: response.headers.get("content-type") || "",
      contentLength: Number(response.headers.get("content-length") || 0) || null,
      contentEncoding: response.headers.get("content-encoding") || "",
      xRobotsTag: response.headers.get("x-robots-tag") || "",
      text: await response.text(),
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
