import {
  HttpError,
  HTTP_ENDPOINTS,
  HTTP_REQUIRED_QUERY_FIELDS,
  HTTP_REQUEST_QUERY_FIELDS,
  assertHttpRequestBody,
  resolveHttpEndpoint,
  shapeHttpPublicResultForEndpoint,
} from "./http-contract.mjs";

const MAX_REQUEST_BODY_BYTES = 1_048_576;

export function createHttpRouteHandler(daemon) {
  if (!daemon || typeof daemon.handleHttpRequest !== "function") {
    throw new TypeError("daemon must expose handleHttpRequest(endpoint, body)");
  }

  return async function httpRouteHandler(req, res) {
    try {
      const { endpoint, pathname, searchParams } = resolveRequestTarget(req.url ?? "");
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

      const routedBody = mergeQueryParams(endpoint, body, searchParams);
      const routedRequest = translateHttpRequestForDaemon(endpoint, routedBody);
      const result = await daemon.handleHttpRequest(routedRequest.endpoint, routedRequest.body);
      const publicResult = translateHttpResultFromDaemon(endpoint, result, routedBody);
      return writeJson(res, 200, shapeHttpPublicResultForEndpoint(endpoint, publicResult));
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
    searchParams: requestUrl.searchParams,
  };
}

function mergeQueryParams(endpoint, body, searchParams) {
  const queryFields = HTTP_REQUEST_QUERY_FIELDS[endpoint] ?? [];
  if (queryFields.length === 0) {
    assertNoUnexpectedQueryParams(endpoint, searchParams);
    return body;
  }

  assertNoUnexpectedQueryParams(endpoint, searchParams);

  const merged = { ...body };
  const requiredFields = HTTP_REQUIRED_QUERY_FIELDS[endpoint] ?? [];

  for (const field of queryFields) {
    const value = searchParams.get(field);
    if (value === null || value.length === 0) {
      if (requiredFields.includes(field)) {
        throw new TypeError(`${field} query parameter is required for ${endpoint}`);
      }
      continue;
    }
    merged[field] = value;
  }

  for (const field of requiredFields) {
    const value = searchParams.get(field);
    if (value === null || value.length === 0) {
      throw new TypeError(`${field} query parameter is required for ${endpoint}`);
    }
  }
  return merged;
}

function assertNoUnexpectedQueryParams(endpoint, searchParams) {
  const allowed = new Set(HTTP_REQUEST_QUERY_FIELDS[endpoint] ?? []);
  const unexpectedFields = [];

  for (const key of new Set(searchParams.keys())) {
    if (!allowed.has(key)) {
      unexpectedFields.push(key);
    }
  }

  if (unexpectedFields.length > 0) {
    throw new TypeError(
      `unknown query parameter(s) for ${endpoint}: ${unexpectedFields.join(", ")}; allowed fields: ${(HTTP_REQUEST_QUERY_FIELDS[endpoint] ?? []).join(", ")}`,
    );
  }
}

function translateHttpRequestForDaemon(endpoint, body) {
  switch (endpoint) {
    case "workspaces":
      return {
        endpoint: "openWorkspace",
        body: {
          createWorkspaceIfMissing: true,
        },
      };
    case "tabs":
      return {
        endpoint: "openWorkspace",
        body: {
          workspaceRef: body.workspaceRef,
          createWorkspaceIfMissing: false,
        },
      };
    case "selectTab":
      return {
        endpoint: "selectTab",
        body: {
          workspaceRef: body.workspaceRef,
          workspaceTabRef: body.workspaceTabRef,
        },
      };
    case "navigate":
      return translateWorkspaceScopedRequest(endpoint, body, {
        url: body.url,
      });
    case "click":
      return translateWorkspaceScopedRequest(endpoint, body, {
        uid: body.uid,
      });
    case "type":
      return translateWorkspaceScopedRequest(endpoint, body, {
        uid: body.uid,
        text: body.text,
        submit: body.submit,
        slowly: body.slowly,
      });
    case "press":
      return translateWorkspaceScopedRequest(endpoint, body, {
        key: body.key,
      });
    case "recordKnowledge":
      return translateWorkspaceScopedRequest(endpoint, body, {
        guide: body.guide,
        keywords: body.keywords,
        rationale: body.rationale,
      });
    case "query":
      return translateWorkspaceScopedRequest("queryWorkspace", body, {
        mode: body.mode,
        query: body.query,
        role: body.role,
        uid: body.uid,
      });
    default:
      return {
        endpoint,
        body,
      };
  }
}

function translateHttpResultFromDaemon(endpoint, result, requestBody) {
  if (!result || typeof result !== "object") {
    return result;
  }

  switch (endpoint) {
    case "workspaces":
      return result;
    case "tabs":
      return {
        ...result,
        workspaceRef: requestBody.workspaceRef,
      };
    case "selectTab":
      return {
        ...result,
        workspaceRef: requestBody.workspaceRef,
        ...(requestBody.workspaceTabRef !== undefined ? { workspaceTabRef: requestBody.workspaceTabRef } : {}),
      };
    case "navigate":
    case "click":
    case "type":
    case "press":
    case "query":
    case "recordKnowledge":
      return {
        ...result,
        workspaceRef: requestBody.workspaceRef,
        ...(result.workspaceTabRef !== undefined
          ? {}
          : requestBody.workspaceTabRef !== undefined
            ? { workspaceTabRef: requestBody.workspaceTabRef }
            : {}),
      };
    default:
      return result;
  }
}

function translateWorkspaceScopedRequest(endpoint, body, extraFields = {}) {
  return {
    endpoint,
    body: omitUndefinedFields({
      ...extraFields,
      workspaceRef: body.workspaceRef,
      workspaceTabRef: body.workspaceTabRef,
    }),
  };
}

function omitUndefinedFields(value) {
  const clone = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      clone[key] = entry;
    }
  }
  return clone;
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
