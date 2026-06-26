import { createHash } from "crypto";
import { resolve } from "path";
import { readdir } from "fs/promises";

const DATA_DIR = resolve(import.meta.dir, "../data");

async function hashFile(path: string): Promise<string> {
  const file = Bun.file(path);
  const buffer = await file.arrayBuffer();
  return createHash("sha256").update(new Uint8Array(buffer)).digest("hex");
}

async function main() {
  console.log("=== Archive Integrity Hash ===");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log("");

  const files = await readdir(DATA_DIR);
  const hashes: Record<string, string> = {};

  for (const file of files.sort()) {
    if (file === "archive-hashes.json") continue;
    const filePath = resolve(DATA_DIR, file);
    const hash = await hashFile(filePath);
    hashes[file] = hash;
    console.log(`${hash}  ${file}`);
  }

  // Create a master hash of all file hashes
  const masterPayload = Object.entries(hashes)
    .map(([name, hash]) => `${hash}  ${name}`)
    .join("\n");
  const masterHash = createHash("sha256").update(masterPayload).digest("hex");

  console.log("");
  console.log(`MASTER HASH: ${masterHash}`);
  console.log("");
  console.log("To verify this archive has not been tampered with:");
  console.log("1. Run `bun run hash` and compare the master hash above");
  console.log("2. Check this hash against the one in the initial Git commit");
  console.log("");

  const output = {
    generated_at: new Date().toISOString(),
    master_hash: masterHash,
    files: hashes,
    instructions: "Compare master_hash against the value in the initial Git commit to verify archive integrity.",
  };

  const outputPath = resolve(DATA_DIR, "archive-hashes.json");
  await Bun.write(outputPath, JSON.stringify(output, null, 2));
  console.log(`Hashes written to ${outputPath}`);
}

main();
