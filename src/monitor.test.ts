import { test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { createHash } from "crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

const DATA_DIR = resolve(import.meta.dir, "../data");

test("manifest loads and contains expected message count", async () => {
  const manifest = await Bun.file(resolve(DATA_DIR, "message-manifest.json")).json();
  expect(manifest.message_ids).toBeDefined();
  expect(manifest.message_ids.length).toBe(41842);
  expect(manifest.server_id).toBe("1321966953350430740");
});

test("manifest message IDs are all strings", async () => {
  const manifest = await Bun.file(resolve(DATA_DIR, "message-manifest.json")).json();
  const sample = manifest.message_ids.slice(0, 100);
  for (const m of sample) {
    expect(typeof m.id).toBe("string");
    expect(m.id).toMatch(/^\d+$/);
  }
});

test("hash chain produces deterministic and unique hashes", () => {
  let previousHash = "GENESIS";
  const hashes: string[] = [];

  for (let i = 0; i < 10; i++) {
    const event = {
      type: "message_deleted",
      timestamp: `2026-06-21T00:00:0${i}.000Z`,
      details: { message_id: `${i}`, was_in_archive: true },
      previous_hash: previousHash,
    };

    const payload = JSON.stringify({ ...event, hash: undefined });
    const hash = createHash("sha256").update(payload + previousHash).digest("hex");
    hashes.push(hash);
    previousHash = hash;
  }

  const unique = new Set(hashes);
  expect(unique.size).toBe(10);

  expect(hashes[0]).toBe(
    createHash("sha256")
      .update(
        JSON.stringify({
          type: "message_deleted",
          timestamp: "2026-06-21T00:00:00.000Z",
          details: { message_id: "0", was_in_archive: true },
          previous_hash: "GENESIS",
          hash: undefined,
        }) + "GENESIS"
      )
      .digest("hex")
  );
});

test("chain breaks if an event is modified", () => {
  let previousHash = "GENESIS";
  const events: any[] = [];

  for (let i = 0; i < 5; i++) {
    const event = {
      type: "message_deleted",
      timestamp: `2026-06-21T00:00:0${i}.000Z`,
      details: { message_id: `${i}`, was_in_archive: true },
      previous_hash: previousHash,
      hash: "",
    };

    const payload = JSON.stringify({ ...event, hash: undefined });
    event.hash = createHash("sha256").update(payload + previousHash).digest("hex");
    previousHash = event.hash;
    events.push({ ...event });
  }

  events[2].details.message_id = "TAMPERED";

  let valid = true;
  let prevHash = "GENESIS";
  for (const event of events) {
    const check = { ...event, hash: undefined };
    const expected = createHash("sha256").update(JSON.stringify(check) + prevHash).digest("hex");
    if (expected !== event.hash) {
      valid = false;
      break;
    }
    prevHash = event.hash;
  }

  expect(valid).toBe(false);
});

test("chain breaks if an event is removed", () => {
  let previousHash = "GENESIS";
  const events: any[] = [];

  for (let i = 0; i < 5; i++) {
    const event = {
      type: "message_deleted",
      timestamp: `2026-06-21T00:00:0${i}.000Z`,
      details: { message_id: `${i}`, was_in_archive: true },
      previous_hash: previousHash,
      hash: "",
    };

    const payload = JSON.stringify({ ...event, hash: undefined });
    event.hash = createHash("sha256").update(payload + previousHash).digest("hex");
    previousHash = event.hash;
    events.push({ ...event });
  }

  const tampered = [events[0], events[1], events[3], events[4]];

  let valid = true;
  let prevHash = "GENESIS";
  for (const event of tampered) {
    const check = { ...event, hash: undefined };
    const expected = createHash("sha256").update(JSON.stringify(check) + prevHash).digest("hex");
    if (expected !== event.hash) {
      valid = false;
      break;
    }
    prevHash = event.hash;
  }

  expect(valid).toBe(false);
});

test("chain breaks if events are reordered", () => {
  let previousHash = "GENESIS";
  const events: any[] = [];

  for (let i = 0; i < 5; i++) {
    const event = {
      type: "message_deleted",
      timestamp: `2026-06-21T00:00:0${i}.000Z`,
      details: { message_id: `${i}`, was_in_archive: true },
      previous_hash: previousHash,
      hash: "",
    };

    const payload = JSON.stringify({ ...event, hash: undefined });
    event.hash = createHash("sha256").update(payload + previousHash).digest("hex");
    previousHash = event.hash;
    events.push({ ...event });
  }

  const tampered = [events[0], events[1], events[3], events[2], events[4]];

  let valid = true;
  let prevHash = "GENESIS";
  for (const event of tampered) {
    const check = { ...event, hash: undefined };
    const expected = createHash("sha256").update(JSON.stringify(check) + prevHash).digest("hex");
    if (expected !== event.hash) {
      valid = false;
      break;
    }
    prevHash = event.hash;
  }

  expect(valid).toBe(false);
});

test("log file writing produces valid JSONL", async () => {
  const tmpDir = await mkdtemp(resolve(tmpdir(), "monitor-test-"));
  const logFile = resolve(tmpDir, "test-log.jsonl");

  const events: any[] = [];
  let previousHash = "GENESIS";

  for (let i = 0; i < 3; i++) {
    const event = {
      type: "message_deleted",
      timestamp: `2026-06-21T00:00:0${i}.000Z`,
      details: { message_id: `${i}`, was_in_archive: true },
      previous_hash: previousHash,
      hash: "",
    };

    const payload = JSON.stringify({ ...event, hash: undefined });
    event.hash = createHash("sha256").update(payload + previousHash).digest("hex");
    previousHash = event.hash;

    const line = JSON.stringify(event) + "\n";
    await Bun.write(logFile, (await Bun.file(logFile).exists() ? await Bun.file(logFile).text() : "") + line);
    events.push(event);
  }

  const content = await Bun.file(logFile).text();
  const lines = content.trim().split("\n");
  expect(lines.length).toBe(3);

  for (let i = 0; i < lines.length; i++) {
    const parsed = JSON.parse(lines[i]);
    expect(parsed.type).toBe("message_deleted");
    expect(parsed.hash).toBe(events[i].hash);
    expect(parsed.previous_hash).toBe(events[i].previous_hash);
  }

  await rm(tmpDir, { recursive: true });
});

test("evidence.json structure is valid", async () => {
  const evidence = await Bun.file(resolve(DATA_DIR, "evidence.json")).json();
  expect(evidence.server.id).toBe("1321966953350430740");
  expect(evidence.flagged_messages.length).toBeGreaterThan(600);
  expect(evidence.stats.categories.length).toBeGreaterThan(0);

  const first = evidence.flagged_messages[0];
  expect(first.id).toBeDefined();
  expect(first.content).toBeDefined();
  expect(first.author_tag).toBeDefined();
  expect(first.timestamp).toBeDefined();
});

test("archive hashes file exists and has master hash", async () => {
  const hashes = await Bun.file(resolve(DATA_DIR, "archive-hashes.json")).json();
  expect(hashes.master_hash).toBeDefined();
  expect(hashes.master_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(hashes.files).toBeDefined();
  expect(Object.keys(hashes.files).length).toBeGreaterThan(0);
});
