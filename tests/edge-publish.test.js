import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCliArguments,
  publishEdgeExtension,
  readConfiguration
} from "../scripts/publish-edge.mjs";

const credentials = {
  clientId: "11111111-1111-4111-8111-111111111111",
  productId: "d34f98f5-f9b7-42b1-bebb-98707202b21d",
  apiKey: "test-edge-api-key"
};
const silentLogger = { log: () => undefined };

test("parses package and certification notes arguments", () => {
  assert.deepEqual(parseCliArguments(["--package", "release.zip"]), {
    packagePath: "release.zip",
    notesFile: "docs/edge-certification-notes.txt"
  });
  assert.deepEqual(parseCliArguments(["--package", "release.zip", "--notes-file", "notes.txt"]), {
    packagePath: "release.zip",
    notesFile: "notes.txt"
  });
  assert.throws(() => parseCliArguments([]), /--package/);
  assert.throws(() => parseCliArguments(["--unknown"]), /Unknown argument/);
});

test("validates credentials and API key expiry", () => {
  const now = Date.parse("2026-07-17T00:00:00Z");
  const configuration = readConfiguration({
    EDGE_CLIENT_ID: credentials.clientId,
    EDGE_PRODUCT_ID: credentials.productId,
    EDGE_API_KEY: credentials.apiKey,
    EDGE_API_KEY_EXPIRES_AT: "2026-09-27T00:00:00Z"
  }, now);

  assert.equal(configuration.apiKeyDaysRemaining, 72);
  assert.throws(() => readConfiguration({}, now), /EDGE_CLIENT_ID/);
  assert.throws(() => readConfiguration({
    EDGE_CLIENT_ID: credentials.clientId,
    EDGE_PRODUCT_ID: credentials.productId,
    EDGE_API_KEY: credentials.apiKey,
    EDGE_API_KEY_EXPIRES_AT: "2026-07-16T00:00:00Z"
  }, now), /expired/);
});

test("uploads, polls, submits, and polls an Edge release", async () => {
  const { calls, fetchImpl } = queuedFetch([
    response(202, null, { location: "/operations/upload-op" }),
    response(200, { status: "InProgress" }),
    response(200, { status: "Succeeded", message: "Package accepted" }),
    response(202, null, { location: "https://example.test/operations/publish-op" }),
    response(200, { status: "InProgress" }),
    response(200, { status: "Succeeded", message: "Submission accepted" })
  ]);
  const logs = [];

  const result = await publishEdgeExtension({
    packageBytes: Buffer.from("zip"),
    notes: "Certification notes",
    ...credentials,
    fetchImpl,
    sleepImpl: async () => undefined,
    logger: { log: (message) => logs.push(message) },
    pollIntervalMs: 0,
    pollAttempts: 2
  });

  assert.equal(result.uploadResult.status, "Succeeded");
  assert.equal(result.publishResult.status, "Succeeded");
  assert.equal(calls.length, 6);
  assert.equal(calls[0].options.headers.Authorization, `ApiKey ${credentials.apiKey}`);
  assert.equal(calls[0].options.headers["X-ClientID"], credentials.clientId);
  assert.equal(calls[0].options.headers["Content-Type"], "application/zip");
  assert.equal(calls[3].options.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(calls[3].options.body, "Certification notes");
  assert.match(calls[1].url, /upload-op$/);
  assert.match(calls[4].url, /publish-op$/);
  assert.equal(logs.join("\n").includes(credentials.apiKey), false);
});

test("redacts the API key from HTTP failures", async () => {
  const { fetchImpl } = queuedFetch([
    response(401, { message: `Invalid credential ${credentials.apiKey}` })
  ]);

  await assert.rejects(
    publishEdgeExtension({
      packageBytes: Buffer.from("zip"),
      notes: "Certification notes",
      ...credentials,
      fetchImpl,
      logger: silentLogger
    }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /\[REDACTED\]/);
      assert.equal(error.message.includes(credentials.apiKey), false);
      return true;
    }
  );
});

test("fails when the API omits an operation ID", async () => {
  const { fetchImpl } = queuedFetch([response(202)]);

  await assert.rejects(
    publishEdgeExtension({
      packageBytes: Buffer.from("zip"),
      notes: "Certification notes",
      ...credentials,
      fetchImpl,
      logger: silentLogger
    }),
    /Location header/
  );
});

test("reports failed and timed-out operations", async (context) => {
  await context.test("failed upload", async () => {
    const { fetchImpl } = queuedFetch([
      response(202, null, { location: "upload-op" }),
      response(200, { status: "Failed", errorCode: "SubmissionValidationError" })
    ]);
    await assert.rejects(
      publishEdgeExtension({
        packageBytes: Buffer.from("zip"),
        notes: "Certification notes",
        ...credentials,
        fetchImpl,
        logger: silentLogger
      }),
      /SubmissionValidationError/
    );
  });

  await context.test("upload timeout", async () => {
    const { fetchImpl } = queuedFetch([
      response(202, null, { location: "upload-op" }),
      response(200, { status: "InProgress" }),
      response(200, { status: "InProgress" })
    ]);
    await assert.rejects(
      publishEdgeExtension({
        packageBytes: Buffer.from("zip"),
        notes: "Certification notes",
        ...credentials,
        fetchImpl,
        logger: silentLogger,
        sleepImpl: async () => undefined,
        pollIntervalMs: 0,
        pollAttempts: 2
      }),
      /Timed out/
    );
  });

  await context.test("unknown status", async () => {
    const { fetchImpl } = queuedFetch([
      response(202, null, { location: "upload-op" }),
      response(200, { status: "Queued" })
    ]);
    await assert.rejects(
      publishEdgeExtension({
        packageBytes: Buffer.from("zip"),
        notes: "Certification notes",
        ...credentials,
        fetchImpl,
        logger: silentLogger
      }),
      /unknown status/
    );
  });
});

function queuedFetch(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      const next = responses.shift();
      if (!next) throw new Error(`Unexpected request: ${url}`);
      return next;
    }
  };
}

function response(status = 200, body, headers = {}) {
  return new Response(body === undefined || body === null ? null : JSON.stringify(body), {
    status,
    headers
  });
}
