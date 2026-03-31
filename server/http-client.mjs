import { BrowserSessionDaemon } from "./browser-sessiond.mjs";

export async function startBrowserSessionDaemon(options = {}) {
  const daemon = new BrowserSessionDaemon(options);
  const metadata = await daemon.start();
  return {
    daemon,
    metadata,
  };
}

export async function requestJson(method, url, body, options = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(parsed?.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.body = parsed;
    throw error;
  }

  return parsed;
}

export async function stopBrowserSessionDaemon(target) {
  if (typeof target === "string") {
    await requestJson("POST", new URL("/shutdown", target).href, {});
    return;
  }

  await target.stop();
}
