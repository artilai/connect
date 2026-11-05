import { mkdir } from "node:fs/promises";

import { createTestServer } from "../src/testing";

// Writes the API the server answers to docs/openapi.json, which CI compares with Artil Cloud's.
const server = await createTestServer();

const spec = await (await server.call("/api/openapi.json")).json();

const docs = new URL("../../../docs/", import.meta.url);

await mkdir(docs, { recursive: true });

await Bun.write(new URL("openapi.json", docs), `${JSON.stringify(spec, null, 2)}\n`);
