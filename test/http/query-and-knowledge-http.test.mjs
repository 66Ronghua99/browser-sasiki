import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  HTTP_ENDPOINTS,
  HTTP_ENDPOINT_NAMES,
  assertHttpRequestBody,
  resolveHttpEndpoint,
  shapeHttpPublicResultForEndpoint,
} from "../../scripts/http-contract.mjs";
import { createHttpRouteHandler } from "../../scripts/http-routes.mjs";

test("HTTP endpoint contract is frozen to the workspace-first active surface", () => {
  assert.deepEqual(HTTP_ENDPOINT_NAMES, [
    "health",
    "workspaces",
    "tabs",
    "selectTab",
    "navigate",
    "click",
    "type",
    "press",
    "query",
    "recordKnowledge",
    "shutdown",
  ]);

  assert.equal(HTTP_ENDPOINTS.query.path, "/query");
  assert.equal(HTTP_ENDPOINTS.workspaces.path, "/workspaces");
  assert.equal(HTTP_ENDPOINTS.tabs.path, "/tabs");
  assert.equal(HTTP_ENDPOINTS.recordKnowledge.path, "/record-knowledge");
  assert.equal(resolveHttpEndpoint("/capture"), null);
  assert.equal(resolveHttpEndpoint("/query-snapshot"), null);
});

test("HTTP request bodies keep workspace identity in query params instead of JSON bodies", () => {
  assert.doesNotThrow(() =>
    assertHttpRequestBody("query", {
      mode: "search",
      query: "Submit",
    }),
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("recordKnowledge", {
      guide: "Check the dashboard header first.",
      keywords: ["dashboard"],
      rationale: "The dashboard heading confirms the page is loaded.",
    }),
  );

  assert.throws(
    () =>
      assertHttpRequestBody("query", {
        workspaceRef: "workspace_demo",
        mode: "search",
        query: "Submit",
      }),
    /workspaceRef/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("query", {
        workspaceTabRef: "workspace_tab_demo",
        mode: "search",
        query: "Submit",
      }),
    /workspaceTabRef/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("recordKnowledge", {
        workspaceRef: "workspace_demo",
        guide: "Check the dashboard header first.",
        keywords: ["dashboard"],
        rationale: "The dashboard heading confirms the page is loaded.",
      }),
    /workspaceRef/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("recordKnowledge", {
        guide: "Check the dashboard header first.",
        keywords: ["dashboard"],
      }),
    /rationale/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("tabs", {
        workspaceRef: "workspace_demo",
      }),
    /workspaceRef/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("query", {
        mode: "search",
        query: "Submit",
        tabRef: "legacy_ref",
      }),
    /unknown field "tabRef"|allowed fields/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("query", {
        mode: "search",
        query: "Submit",
        snapshotRef: "legacy_snapshot",
      }),
    /unknown field "snapshotRef"|allowed fields/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("recordKnowledge", {
        pageId: "legacy_page",
        guide: "Check the dashboard header first.",
        keywords: ["dashboard"],
        rationale: "The dashboard heading confirms the page is loaded.",
      }),
    /unknown field "pageId"|allowed fields/i,
  );
});

test("HTTP route handler rejects unsupported query parameters", async () => {
  const calls = [];
  const routeHandler = createHttpRouteHandler({
    handleHttpRequest: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return {
        ok: true,
        workspaceRef: body.workspaceRef,
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
      };
    },
  });

  const { statusCode, body } = await invokeRoute(routeHandler, {
    method: "POST",
    url: "/query?workspaceRef=workspace_demo&snapshotRef=legacy_snapshot",
    body: {
      mode: "search",
      query: "Submit",
    },
  });

  assert.equal(statusCode, 400);
  assert.match(body.error, /unknown query parameter/i);
  assert.deepEqual(calls, []);
});

test("HTTP route handler parses workspace identity from query params before invoking the workspace runtime owner", async () => {
  const calls = [];
  const routeHandler = createHttpRouteHandler({
    handleHttpRequest: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return {
        ok: true,
        workspaceRef: body.workspaceRef,
        snapshotPath: "/tmp/private.md",
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
      };
    },
  });

  const { statusCode, body } = await invokeRoute(routeHandler, {
    method: "POST",
    url: "/query?workspaceRef=workspace_demo",
    body: {
      mode: "search",
      query: "Submit",
    },
  });

  assert.equal(statusCode, 200);
  assert.deepEqual(calls, [
    {
      endpoint: "queryWorkspace",
      body: {
        mode: "search",
        query: "Submit",
        workspaceRef: "workspace_demo",
      },
    },
  ]);
  assert.equal(body.workspaceRef, "workspace_demo");
  assert.equal(body.workspaceTabRef, undefined);
  assert.equal(body.snapshotPath, undefined);
});

test("HTTP route handler keeps explicit workspaceTabRef inside one workspace-scoped daemon request", async () => {
  const calls = [];
  const routeHandler = createHttpRouteHandler({
    handleHttpRequest: async (endpoint, body) => {
      calls.push({ endpoint, body });
      if (endpoint === "queryWorkspace") {
        return {
          ok: true,
          workspaceRef: "workspace_demo",
          page: {
            origin: "https://example.com",
            normalizedPath: "/dashboard",
            title: "Dashboard",
          },
          knowledgeHits: [],
          summary: "ready",
        };
      }

      if (endpoint === "recordKnowledge") {
        return {
          ok: true,
          workspaceRef: "workspace_demo",
          page: {
            origin: "https://example.com",
            normalizedPath: "/dashboard",
            title: "Dashboard",
          },
          knowledgeHits: [],
          summary: "recorded",
          record: {
            guide: body.guide,
            keywords: body.keywords,
            rationale: body.rationale,
            page: {
              origin: "https://example.com",
              normalizedPath: "/dashboard",
              title: "Dashboard",
            },
          },
        };
      }

      return {
        ok: true,
        workspaceRef: "workspace_demo",
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
      };
    },
  });

  const navigate = await invokeRoute(routeHandler, {
    method: "POST",
    url: "/navigate?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_opaque",
    body: {
      url: "https://example.com/dashboard",
    },
  });
  const query = await invokeRoute(routeHandler, {
    method: "POST",
    url: "/query?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_opaque",
    body: {
      mode: "search",
      query: "Submit",
    },
  });
  const recordKnowledge = await invokeRoute(routeHandler, {
    method: "POST",
    url: "/record-knowledge?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_opaque",
    body: {
      guide: "Check the dashboard header first.",
      keywords: ["dashboard"],
      rationale: "The dashboard heading confirms the page is loaded.",
    },
  });

  assert.deepEqual(calls, [
    {
      endpoint: "navigate",
      body: {
        workspaceRef: "workspace_demo",
        workspaceTabRef: "workspace_tab_opaque",
        url: "https://example.com/dashboard",
      },
    },
    {
      endpoint: "queryWorkspace",
      body: {
        workspaceRef: "workspace_demo",
        workspaceTabRef: "workspace_tab_opaque",
        mode: "search",
        query: "Submit",
      },
    },
    {
      endpoint: "recordKnowledge",
      body: {
        workspaceRef: "workspace_demo",
        workspaceTabRef: "workspace_tab_opaque",
        guide: "Check the dashboard header first.",
        keywords: ["dashboard"],
        rationale: "The dashboard heading confirms the page is loaded.",
      },
    },
  ]);

  assert.equal(navigate.statusCode, 200);
  assert.equal(navigate.body.workspaceRef, "workspace_demo");
  assert.equal(navigate.body.workspaceTabRef, "workspace_tab_opaque");

  assert.equal(query.statusCode, 200);
  assert.equal(query.body.workspaceRef, "workspace_demo");
  assert.equal(query.body.workspaceTabRef, "workspace_tab_opaque");

  assert.equal(recordKnowledge.statusCode, 200);
  assert.equal(recordKnowledge.body.workspaceRef, "workspace_demo");
  assert.equal(recordKnowledge.body.workspaceTabRef, "workspace_tab_opaque");
  assert.equal(recordKnowledge.body.record.guide, "Check the dashboard header first.");
  assert.equal(recordKnowledge.body.summary.includes("recorded"), true);
});

test("HTTP route handler bridges workspace-first workspace listing endpoints onto the workspace runtime owner", async () => {
  const calls = [];
  const routeHandler = createHttpRouteHandler({
    handleHttpRequest: async (endpoint, body) => {
      calls.push({ endpoint, body });
      return {
        ok: true,
        workspaceRef: body.workspaceRef ?? "workspace_demo",
        snapshotPath: "/tmp/private.md",
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
        tabs: [
          {
            workspaceTabRef: "workspace_tab_0",
            title: "Dashboard",
            url: "https://example.com/dashboard",
            active: true,
          },
        ],
      };
    },
  });

  const { body: openWorkspaceBody } = await invokeRoute(routeHandler, {
    method: "POST",
    url: "/workspaces",
    body: {},
  });
  const workspaceRef = openWorkspaceBody.workspaceRef;

  const { body: listTabsBody } = await invokeRoute(routeHandler, {
    method: "GET",
    url: `/tabs?workspaceRef=${workspaceRef}`,
  });

  assert.deepEqual(calls, [
    {
      endpoint: "openWorkspace",
      body: {
        createWorkspaceIfMissing: true,
      },
    },
    {
      endpoint: "openWorkspace",
      body: {
        workspaceRef,
        createWorkspaceIfMissing: false,
      },
    },
  ]);
  assert.equal(typeof workspaceRef, "string");
  assert.equal(openWorkspaceBody.tabs[0].workspaceTabRef, "workspace_tab_0");
  assert.equal(listTabsBody.workspaceRef, workspaceRef);
  assert.equal(listTabsBody.tabs[0].workspaceTabRef, "workspace_tab_0");
});

test("public HTTP result shaping enforces workspace-first endpoint-specific results", () => {
  const openWorkspace = shapeHttpPublicResultForEndpoint("workspaces", {
    ok: true,
    workspaceRef: "workspace_demo",
    snapshotPath: "/tmp/private.md",
    page: {
      origin: "https://example.com",
      normalizedPath: "/dashboard",
      title: "Dashboard",
    },
    knowledgeHits: [],
    summary: "ready",
    tabs: [
      {
        workspaceTabRef: "workspace_tab_0",
        title: "Dashboard",
        url: "https://example.com/dashboard",
        active: true,
      },
    ],
  });

  assert.equal(openWorkspace.workspaceRef, "workspace_demo");
  assert.equal(openWorkspace.workspaceTabRef, undefined);
  assert.equal(openWorkspace.snapshotPath, undefined);
  assert.equal(openWorkspace.tabs[0].workspaceTabRef, "workspace_tab_0");

  const tabs = shapeHttpPublicResultForEndpoint("tabs", {
    ok: true,
    workspaceRef: "workspace_demo",
    snapshotPath: "/tmp/private.md",
    page: {
      origin: "https://example.com",
      normalizedPath: "/dashboard",
      title: "Dashboard",
    },
    knowledgeHits: [],
    summary: "ready",
    tabs: [
      {
        workspaceTabRef: "workspace_tab_demo",
        title: "Dashboard",
        url: "https://example.com/dashboard",
        active: true,
      },
    ],
  });

  assert.equal(tabs.workspaceRef, "workspace_demo");
  assert.equal(tabs.workspaceTabRef, undefined);
  assert.equal(tabs.snapshotPath, undefined);
  assert.equal(tabs.tabs[0].workspaceTabRef, "workspace_tab_demo");
  assert.equal(tabs.tabs[0].index, undefined);

  assert.throws(
    () =>
      shapeHttpPublicResultForEndpoint("tabs", {
        ok: true,
        workspaceRef: "workspace_demo",
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
        tabs: [
          {
            title: "Dashboard",
            url: "https://example.com/dashboard",
            active: true,
          },
        ],
      }),
    /workspaceTabRef/i,
  );

  const shaped = shapeHttpPublicResultForEndpoint("query", {
    ok: true,
    workspaceRef: "workspace_demo",
    snapshotPath: "/tmp/private.md",
    page: {
      origin: "https://example.com",
      normalizedPath: "/dashboard",
      title: "Dashboard",
    },
    knowledgeHits: [],
    summary: "ready",
  });

  assert.equal(shaped.workspaceRef, "workspace_demo");
  assert.equal(shaped.workspaceTabRef, undefined);
  assert.equal(shaped.snapshotPath, undefined);

  assert.throws(
    () =>
      shapeHttpPublicResultForEndpoint("query", {
        ok: true,
        workspaceTabRef: "workspace_tab_demo",
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
      }),
    /workspaceRef/i,
  );

  assert.throws(
    () =>
      shapeHttpPublicResultForEndpoint("workspaces", {
        ok: true,
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
      }),
    /workspaceRef/i,
  );

  assert.throws(
    () =>
      shapeHttpPublicResultForEndpoint("selectTab", {
        ok: true,
        workspaceRef: "workspace_demo",
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        knowledgeHits: [],
        summary: "ready",
      }),
    /workspaceTabRef/i,
  );

});

test("HTTP request bodies keep uid as the only public selector handle", () => {
  assert.doesNotThrow(() =>
    assertHttpRequestBody("click", {
      uid: "submit_button",
    }),
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("type", {
      uid: "query_input",
      text: "zara zhang",
    }),
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("query", {
      mode: "search",
      uid: "submit_button",
    }),
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("query", {
      mode: "search",
      query: "Submit",
    }),
  );

  assert.throws(
    () =>
      assertHttpRequestBody("click", {
        ref: "submit_button",
      }),
    /unknown field "ref"|allowed fields/i,
  );
});

test("HTTP request bodies keep rejecting playwright-only element payloads with allowed field guidance", () => {
  assert.throws(
    () =>
      assertHttpRequestBody("click", {
        element: "Search result link",
      }),
    /allowed fields:.*uid/i,
  );
});

function invokeRoute(routeHandler, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(
      body === undefined ? [] : [JSON.stringify(body)],
    );
    request.method = method;
    request.url = url;

    const response = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      end(payload) {
        try {
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            body: payload ? JSON.parse(payload) : null,
          });
        } catch (error) {
          reject(error);
        }
      },
    };

    routeHandler(request, response).catch(reject);
  });
}
