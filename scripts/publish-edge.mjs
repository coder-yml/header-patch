import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API_BASE_URL = "https://api.addons.microsoftedge.microsoft.com";
const DEFAULT_NOTES_FILE = "docs/edge-certification-notes.txt";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_ATTEMPTS = 60;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

const usage = `Usage:
  npm run publish:edge -- --package <extension.zip> [--notes-file <path>]

Required environment variables:
  EDGE_CLIENT_ID
  EDGE_PRODUCT_ID
  EDGE_API_KEY
  EDGE_API_KEY_EXPIRES_AT
`;

export function parseCliArguments(args) {
  const options = { notesFile: DEFAULT_NOTES_FILE };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--package") {
      options.packagePath = args[++index];
      if (!options.packagePath) throw new Error("Missing value for --package");
      continue;
    }
    if (argument === "--notes-file") {
      options.notesFile = args[++index];
      if (!options.notesFile) throw new Error("Missing value for --notes-file");
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.packagePath) throw new Error("Missing required argument: --package");
  return options;
}

export function readConfiguration(environment, now = Date.now()) {
  const required = [
    "EDGE_CLIENT_ID",
    "EDGE_PRODUCT_ID",
    "EDGE_API_KEY",
    "EDGE_API_KEY_EXPIRES_AT"
  ];
  const values = Object.fromEntries(required.map((name) => [name, environment[name]?.trim()]));

  for (const name of required) {
    if (!values[name]) throw new Error(`Missing required environment variable: ${name}`);
  }
  for (const name of ["EDGE_CLIENT_ID", "EDGE_PRODUCT_ID"]) {
    if (!GUID_PATTERN.test(values[name])) throw new Error(`Invalid GUID in ${name}`);
  }

  const expiresAt = Date.parse(values.EDGE_API_KEY_EXPIRES_AT);
  if (!Number.isFinite(expiresAt)) {
    throw new Error("EDGE_API_KEY_EXPIRES_AT must be an ISO-8601 date or timestamp");
  }
  if (expiresAt <= now) throw new Error("EDGE_API_KEY has expired; rotate it before publishing");

  return {
    clientId: values.EDGE_CLIENT_ID,
    productId: values.EDGE_PRODUCT_ID,
    apiKey: values.EDGE_API_KEY,
    apiKeyExpiresAt: expiresAt,
    apiKeyDaysRemaining: Math.ceil((expiresAt - now) / DAY_MS)
  };
}

export async function publishEdgeExtension({
  packageBytes,
  notes,
  clientId,
  productId,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  logger = console,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollAttempts = DEFAULT_POLL_ATTEMPTS,
  apiBaseUrl = API_BASE_URL
}) {
  if (!packageBytes?.length) throw new Error("Edge package is empty");
  if (!notes?.trim()) throw new Error("Edge certification notes are empty");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  const productUrl = `${apiBaseUrl}/v1/products/${productId}`;
  const authHeaders = {
    Authorization: `ApiKey ${apiKey}`,
    "X-ClientID": clientId
  };

  const uploadResponse = await safeFetch(
    `${productUrl}/submissions/draft/package`,
    {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/zip" },
      body: packageBytes
    },
    { apiKey, fetchImpl }
  );
  await requireAccepted(uploadResponse, "upload", apiKey);
  const uploadOperationId = getOperationId(uploadResponse.headers.get("location"));
  logger.log(`Edge upload accepted: ${uploadOperationId}`);

  const uploadResult = await pollOperation({
    url: `${productUrl}/submissions/draft/package/operations/${uploadOperationId}`,
    phase: "upload",
    authHeaders,
    apiKey,
    fetchImpl,
    sleepImpl,
    logger,
    pollIntervalMs,
    pollAttempts
  });

  const publishResponse = await safeFetch(
    `${productUrl}/submissions`,
    {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "text/plain; charset=utf-8" },
      body: notes.trim()
    },
    { apiKey, fetchImpl }
  );
  await requireAccepted(publishResponse, "publish", apiKey);
  const publishOperationId = getOperationId(publishResponse.headers.get("location"));
  logger.log(`Edge publish accepted: ${publishOperationId}`);

  const publishResult = await pollOperation({
    url: `${productUrl}/submissions/operations/${publishOperationId}`,
    phase: "publish",
    authHeaders,
    apiKey,
    fetchImpl,
    sleepImpl,
    logger,
    pollIntervalMs,
    pollAttempts
  });

  return { uploadResult, publishResult };
}

async function pollOperation({
  url,
  phase,
  authHeaders,
  apiKey,
  fetchImpl,
  sleepImpl,
  logger,
  pollIntervalMs,
  pollAttempts
}) {
  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    const response = await safeFetch(url, { headers: authHeaders }, { apiKey, fetchImpl });
    if (!response.ok) throw await responseError(response, `${phase} status`, apiKey);
    const result = await readResponse(response);

    if (result.status === "Succeeded") {
      logger.log(`Edge ${phase} succeeded.`);
      return result;
    }
    if (result.status === "Failed") {
      throw new Error(`Edge ${phase} failed: ${safeJson(result, apiKey)}`);
    }
    if (result.status !== "InProgress") {
      throw new Error(`Edge ${phase} returned an unknown status: ${safeJson(result, apiKey)}`);
    }
    if (attempt === pollAttempts) {
      throw new Error(`Timed out waiting for Edge ${phase} operation after ${pollAttempts} attempts`);
    }

    logger.log(`Edge ${phase} is still in progress (${attempt}/${pollAttempts}).`);
    await sleepImpl(pollIntervalMs);
  }

  throw new Error(`Edge ${phase} polling ended unexpectedly`);
}

async function safeFetch(url, options, { apiKey, fetchImpl }) {
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    throw new Error(sanitize(`Edge API request failed: ${error?.message || error}`, apiKey));
  }
}

async function requireAccepted(response, phase, apiKey) {
  if (response.status !== 202) throw await responseError(response, phase, apiKey);
}

async function responseError(response, phase, apiKey) {
  const result = await readResponse(response);
  return new Error(`Edge ${phase} request failed with HTTP ${response.status}: ${safeJson(result, apiKey)}`);
}

async function readResponse(response) {
  const content = await response.text();
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

function getOperationId(location) {
  if (!location) throw new Error("Edge API did not return an operation ID in the Location header");
  const operationId = location.split("/").filter(Boolean).at(-1)?.split(/[?#]/, 1)[0];
  if (!operationId) throw new Error("Edge API returned an invalid Location header");
  return operationId;
}

function safeJson(value, apiKey) {
  return sanitize(JSON.stringify(value), apiKey);
}

function sanitize(value, apiKey) {
  return apiKey ? String(value).replaceAll(apiKey, "[REDACTED]") : String(value);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }

  const configuration = readConfiguration(process.env);
  if (configuration.apiKeyDaysRemaining <= 14) {
    console.warn(`EDGE_API_KEY expires in ${configuration.apiKeyDaysRemaining} day(s); rotate it soon.`);
  }

  const [packageBytes, notes] = await Promise.all([
    readFile(options.packagePath),
    readFile(options.notesFile, "utf8")
  ]);
  const result = await publishEdgeExtension({
    packageBytes,
    notes,
    ...configuration
  });
  console.log(sanitize(JSON.stringify(result, null, 2), configuration.apiKey));
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
