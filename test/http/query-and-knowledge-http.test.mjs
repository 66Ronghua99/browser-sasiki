import assert from "node:assert/strict";
import test from "node:test";

import { HTTP_ENDPOINTS, HTTP_ENDPOINT_NAMES, assertHttpRequestBody, shapeHttpPublicResult } from "../../scripts/http-contract.mjs";
import { createHttpRouteHandler } from "../../scripts/http-routes.mjs";

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
      mode: "full",
    }),
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("querySnapshot", {
      snapshotRef: "snapshot_demo",
      mode: "search",
      uid: "1_1",
    }),
  );

  assert.throws(
    () =>
      assertHttpRequestBody("querySnapshot", {
        tabRef: "tab_demo",
        mode: "auto",
      }),
    /search|full/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("querySnapshot", {
        tabRef: "tab_demo",
      }),
    /mode/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("querySnapshot", {
        tabRef: "tab_demo",
        snapshotRef: "snapshot_demo",
        mode: "full",
      }),
    /exactly one|tabRef|snapshotRef/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("querySnapshot", {
        tabRef: "tab_demo",
        mode: "full",
        query: "Submit",
      }),
    /full.*selector|query/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("querySnapshot", {
        tabRef: "tab_demo",
        mode: "search",
      }),
    /search.*query|search.*role|search.*uid/i,
  );

  assert.throws(
    () =>
      assertHttpRequestBody("querySnapshot", {
        tabRef: "tab_demo",
        mode: "search",
        ref: "legacy_ref",
      }),
    /unknown field "ref"|allowed fields/i,
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

test("HTTP request bodies keep uid as the only public selector handle", () => {
  assert.doesNotThrow(() =>
    assertHttpRequestBody("click", {
      tabRef: "tab_demo",
      uid: "submit_button",
    }),
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("type", {
      tabRef: "tab_demo",
      uid: "query_input",
      text: "zara zhang",
    }),
  );

  assert.doesNotThrow(() =>
    assertHttpRequestBody("querySnapshot", {
      tabRef: "tab_demo",
      mode: "search",
      uid: "submit_button",
    }),
  );

  assert.throws(
    () =>
      assertHttpRequestBody("click", {
        tabRef: "tab_demo",
        ref: "submit_button",
      }),
    /unknown field "ref"|allowed fields/i,
  );
});

test("HTTP request bodies keep rejecting playwright-only element payloads with allowed field guidance", () => {
  assert.throws(
    () =>
      assertHttpRequestBody("click", {
        tabRef: "tab_demo",
        element: "Search result link",
      }),
    /allowed fields: tabRef, uid/i,
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
