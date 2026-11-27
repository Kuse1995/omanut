#!/usr/bin/env node
/**
 * Idempotent cross-project Supabase Storage copier (zero dependencies, native fetch).
 *
 * Usage:
 *   SOURCE_SUPABASE_URL=https://dzheddvoiauevcayifev.supabase.co \
 *   SOURCE_SERVICE_ROLE_KEY=... \
 *   DEST_SUPABASE_URL=https://rwjeuiwaiflidurgqpks.supabase.co \
 *   DEST_SERVICE_ROLE_KEY=... \
 *   node scripts/migrate-storage.mjs
 *
 * Optional:
 *   BUCKETS=company-media,company-documents  (defaults to all 6 Omanut buckets)
 *   OVERWRITE=true                           (default false: skips files already present in destination)
 */

const SOURCE_URL = (process.env.SOURCE_SUPABASE_URL || "").replace(/\/+$/, "");
const SOURCE_KEY = process.env.SOURCE_SERVICE_ROLE_KEY || "";
const DEST_URL = (process.env.DEST_SUPABASE_URL || "https://rwjeuiwaiflidurgqpks.supabase.co").replace(/\/+$/, "");
const DEST_KEY = process.env.DEST_SERVICE_ROLE_KEY || "";
const OVERWRITE = process.env.OVERWRITE === "true";

const DEFAULT_BUCKETS = [
  "company-documents",
  "company-media",
  "payment-proofs",
  "conversation-media",
  "digital-products",
  "email-assets",
];

const BUCKETS = (process.env.BUCKETS || DEFAULT_BUCKETS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!SOURCE_URL || !SOURCE_KEY || !DEST_URL || !DEST_KEY) {
  console.error("Missing required env vars: SOURCE_SUPABASE_URL, SOURCE_SERVICE_ROLE_KEY, DEST_SUPABASE_URL, DEST_SERVICE_ROLE_KEY");
  process.exit(1);
}

function authHeaders(key, extra = {}) {
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    ...extra,
  };
}

async function listObjectsRecursive(baseUrl, key, bucket, prefix = "") {
  const results = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(`${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: authHeaders(key, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`List failed (${bucket}/${prefix}): ${res.status} ${body}`);
    }

    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        // Folder entry
        const sub = await listObjectsRecursive(baseUrl, key, bucket, fullPath);
        results.push(...sub);
      } else {
        results.push({
          path: fullPath,
          mimeType: item.metadata?.mimetype || "application/octet-stream",
        });
      }
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return results;
}

function encodeObjectPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

async function objectExists(baseUrl, key, bucket, objectPath) {
  const res = await fetch(
    `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`,
    { method: "HEAD", headers: authHeaders(key) }
  );
  return res.ok;
}

async function copyBucket(bucket) {
  console.log(`\n=== Bucket: ${bucket} ===`);
  let items;
  try {
    items = await listObjectsRecursive(SOURCE_URL, SOURCE_KEY, bucket);
  } catch (err) {
    console.warn(`Skipping or error listing ${bucket}:`, err.message);
    return { bucket, total: 0, copied: 0, skipped: 0, failed: 1 };
  }

  console.log(`Found ${items.length} objects in source ${bucket}`);
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const { path: objectPath, mimeType } = items[i];
    const encodedPath = encodeObjectPath(objectPath);

    try {
      if (!OVERWRITE && (await objectExists(DEST_URL, DEST_KEY, bucket, objectPath))) {
        skipped++;
        continue;
      }

      const srcRes = await fetch(
        `${SOURCE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        { headers: authHeaders(SOURCE_KEY) }
      );
      if (!srcRes.ok) {
        throw new Error(`download HTTP ${srcRes.status}`);
      }

      const contentType = srcRes.headers.get("content-type") || mimeType || "application/octet-stream";
      const bytes = new Uint8Array(await srcRes.arrayBuffer());

      const dstRes = await fetch(
        `${DEST_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        {
          method: "POST",
          headers: authHeaders(DEST_KEY, {
            "Content-Type": contentType,
            "x-upsert": "true",
          }),
          body: bytes,
        }
      );

      if (!dstRes.ok) {
        const errBody = await dstRes.text();
        throw new Error(`upload HTTP ${dstRes.status} ${errBody}`);
      }

      copied++;
      if (copied % 25 === 0 || copied === items.length) {
        console.log(`  [${bucket}] copied=${copied}, skipped=${skipped}, failed=${failed} (${i + 1}/${items.length})`);
      }
    } catch (err) {
      failed++;
      console.error(`  [${bucket}] FAILED ${objectPath}: ${err.message}`);
    }
  }

  return { bucket, total: items.length, copied, skipped, failed };
}

const summary = [];
for (const bucket of BUCKETS) {
  summary.push(await copyBucket(bucket));
}

console.log("\n=== Storage Migration Summary ===");
console.table(summary);

if (summary.some((s) => s.failed > 0)) {
  process.exit(1);
}
