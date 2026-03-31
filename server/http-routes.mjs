import { HttpError, HTTP_ENDPOINTS, assertHttpRequestBody, resolveHttpEndpoint, shapeHttpPublicResult } from "./http-contract.mjs";

const MAX_REQUEST_BODY_BYTES = 1_048_576;

export function createHttpRouteHandler(daemon) {
  if (!daemon || typeof daemon.handleHttpRequest !== "function") {
    throw new TypeError("daemon must expose handleHttpRequest(endpoint, body)");
  }

  return async function httpRouteHandler(req, res) {
    try {
      const { endpoint, pathname } = resolveRequestTarget(req.url ?? "");
      if (!endpoint) {
        return writeJson(res, 404, {
          ok: false,
          error: `Unknown endpoint ${pathname}`,
        });
      }

      const definition = HTTP_ENDPOINTS[endpoint];
      if (!definition || definition.method !== req.method) {
        return writeJson(res, 405, {
          ok: false,
          error: `Method ${req.method} is not allowed for ${pathname}`,
          allowedMethods: definition ? [definition.method] : [],
        });
      }

      const body = definition.method === "GET" ? {} : await readJsonRequestBody(req);
      assertHttpRequestBody(endpoint, body);

      const result = await daemon.handleHttpRequest(endpoint, body);
      return writeJson(res, 200, shapeHttpPublicResult(result));
    } catch (error) {
      return writeJson(res, httpStatusFromError(error), {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };
}

function resolveRequestTarget(rawUrl) {
  const requestUrl = new URL(rawUrl, "http://127.0.0.1");
  const endpoint = resolveHttpEndpoint(requestUrl.pathname);
  return {
    endpoint,
    pathname: requestUrl.pathname,
  };
}

async function readJsonRequestBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large");
    }
  }

  if (raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new HttpError(400, "Request body must be a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

function writeJson(res, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(payload);
}

function httpStatusFromError(error) {
  if (error instanceof HttpError && Number.isInteger(error.status)) {
    return error.status;
  }
  if (error instanceof TypeError) {
    return 400;
  }
  return 500;
}
