import { createHash } from "crypto";
import { resolve } from "path";
import { readdir } from "fs/promises";

const LOGS_DIR = resolve(import.meta.dir, "../logs");

async function main() {
  const files = (await readdir(LOGS_DIR)).filter((f) => f.startsWith("tamper-log-")).sort();

  if (files.length === 0) {
    console.log("No tamper logs found.");
    return;
  }

  let totalEvents = 0;
  let chainValid = true;
  let previousHash = "GENESIS";
  let deletions = 0;
  let edits = 0;
  let bulkDeletes = 0;
  let trackedDeletions = 0;

  for (const file of files) {
    const content = await Bun.file(resolve(LOGS_DIR, file)).text();
    const lines = content.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      const event = JSON.parse(line);

      if (event.type === "heartbeat") continue;

      totalEvents++;

      const expectedPayload = JSON.stringify({ ...event, hash: undefined });
      const expectedHash = createHash("sha256")
        .update(expectedPayload + previousHash)
        .digest("hex");

      if (event.previous_hash !== previousHash) {
        console.error(`CHAIN BROKEN at event ${totalEvents} in ${file}`);
        console.error(`  Expected previous_hash: ${previousHash}`);
        console.error(`  Got: ${event.previous_hash}`);
        chainValid = false;
      }

      if (event.hash !== expectedHash) {
        console.error(`HASH MISMATCH at event ${totalEvents} in ${file}`);
        chainValid = false;
      }

      previousHash = event.hash;

      switch (event.type) {
        case "message_deleted":
          deletions++;
          if (event.details.was_in_archive) trackedDeletions++;
          break;
        case "message_edited":
          edits++;
          break;
        case "bulk_delete":
          bulkDeletes++;
          trackedDeletions += event.details.tracked_count ?? 0;
          break;
      }
    }
  }

  console.log("=== Tamper Log Verification ===");
  console.log(`Log files: ${files.length}`);
  console.log(`Total events: ${totalEvents}`);
  console.log(`Chain integrity: ${chainValid ? "VALID" : "BROKEN"}`);
  console.log("");
  console.log("=== Tampering Summary ===");
  console.log(`Messages deleted: ${deletions}`);
  console.log(`Messages edited: ${edits}`);
  console.log(`Bulk deletes: ${bulkDeletes}`);
  console.log(`Archived messages affected: ${trackedDeletions}`);

  if (trackedDeletions > 0) {
    console.log("");
    console.log("WARNING: Messages from the original evidence archive have been deleted or modified.");
    console.log("This indicates tampering with evidence after the archive was published.");
  }
}

main();
