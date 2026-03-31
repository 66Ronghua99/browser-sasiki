import assert from "node:assert/strict";
import test from "node:test";

import { HTTP_ENDPOINTS, HTTP_ENDPOINT_NAMES, assertHttpRequestBody, shapeHttpPublicResult } from "../../server/http-contract.mjs";
import { createHttpRouteHandler } from "../../server/http-routes.mjs";

test("HTTP endpoint contract is frozen to the browser-skill active surface", () => {
  assert.deepEqual(HTTP_ENDPOINT_NAMES, [
    "health",
    "capture",
    "navigate",
    "click",
    "type",
    "press",
    "selectTab",
    "querySnapshot",
    "recordKnowledge",
    "shutdown",
  ]);

  assert.equal(HTTP_ENDPOINTS.readKnowledge, undefined);
  assert.equal(HTTP_ENDPOINTS.querySnapshot.path, "/query-snapshot");
  assert.equal(HTTP_ENDPOINTS.recordKnowledge.path, "/record-knowledge");
});

test("HTTP request bodies reject legacy read-knowledge fields and keep the active query contract narrow", () => {
  assert.doesNotThrow(() =>
    assertHttpRequestBody("querySnapshot", {
      tabRef: "tab_demo",
      snapshotRef: "snapshot_demo",
      mode: "full",
    }),
  );

  assert.throws(
    () =>
      assertHttpRequestBody("querySnapshot", {
        tabRef: "tab_demo",
        snapshotRef: "snapshot_demo",
        includeSnapshot: true,
      }),
    /includeSnapshot|unknown/i,
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("recordKnowledge", {
      tabRef: "tab_demo",
      snapshotRef: "snapshot_demo",
      page: {
        origin: "https://example.com",
        normalizedPath: "/dashboard",
        title: "Dashboard",
      },
      guide: "Check the dashboard header first.",
      keywords: ["dashboard"],
    }),
  );

  assert.throws(
    () =>
      assertHttpRequestBody("recordKnowledge", {
        tabRef: "tab_demo",
        snapshotRef: "snapshot_demo",
        page: {
          origin: "https://example.com",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
        guide: "Check the dashboard header first.",
        keywords: ["dashboard"],
        readKnowledge: true,
      }),
    /readKnowledge|unknown/i,
  );
});

test("public HTTP result shaping strips snapshotPath from nested daemon output", () => {
  const shaped = shapeHttpPublicResult({
    ok: true,
    tabRef: "tab_demo",
    snapshotRef: "snapshot_demo",
    snapshotPath: "/tmp/private.md",
    page: {
      origin: "https://example.com",
      normalizedPath: "/dashboard",
      title: "Dashboard",
    },
    knowledgeHits: [],
    summary: "ready",
  });

  assert.equal(shaped.snapshotPath, undefined);
});

test("route handler can be constructed for the HTTP-only front door", () => {
  const routeHandler = createHttpRouteHandler({
    handleHttpRequest: async (endpoint) => ({
      ok: true,
      endpoint,
    }),
  });

  assert.equal(typeof routeHandler, "function");
});
