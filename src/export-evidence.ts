import { Database } from "bun:sqlite";
import { resolve } from "path";

const SOURCE_DB = resolve(import.meta.dir, "../../investigation.db");
const OUTPUT_DIR = resolve(import.meta.dir, "../data");

const db = new Database(SOURCE_DB, { readonly: true });

const flaggedMessages = db.query(`
  SELECT
    m.id,
    m.channel_id,
    m.channel_name,
    m.author_id,
    m.author_tag,
    m.content,
    m.timestamp,
    m.message_url,
    m.reply_to,
    GROUP_CONCAT(DISTINCT f.category) as categories,
    GROUP_CONCAT(DISTINCT f.matched_term) as matched_terms,
    GROUP_CONCAT(DISTINCT f.source) as detection_sources
  FROM messages m
  JOIN flagged f ON m.id = f.message_id
  GROUP BY m.id
  ORDER BY m.timestamp
`).all();

const replyIds = flaggedMessages
  .map((m: any) => m.reply_to)
  .filter(Boolean);

const contextMessages = replyIds.length > 0
  ? db.query(`
      SELECT id, channel_id, channel_name, author_id, author_tag, content, timestamp, message_url
      FROM messages
      WHERE id IN (${replyIds.map(() => "?").join(",")})
    `).all(...replyIds)
  : [];

const metadata = db.query("SELECT * FROM guild_metadata").get();

const evidence = {
  exported_at: new Date().toISOString(),
  server: {
    id: "1321966953350430740",
    name: "TheSwiftCheetahs",
    owner_id: "670751182016479263",
    ...(metadata as any),
  },
  stats: {
    total_messages_analyzed: db.query("SELECT COUNT(*) as c FROM messages").get() as any,
    total_flagged_messages: flaggedMessages.length,
    total_flags: db.query("SELECT COUNT(*) as c FROM flagged").get() as any,
    categories: db.query(`
      SELECT category, COUNT(*) as count
      FROM flagged
      GROUP BY category
      ORDER BY count DESC
    `).all(),
    top_offenders: db.query(`
      SELECT m.author_tag, COUNT(DISTINCT m.id) as flagged_messages, GROUP_CONCAT(DISTINCT f.category) as categories
      FROM messages m
      JOIN flagged f ON m.id = f.message_id
      GROUP BY m.author_id
      ORDER BY flagged_messages DESC
      LIMIT 25
    `).all(),
  },
  flagged_messages: flaggedMessages,
  context_messages: contextMessages,
};

const evidencePath = resolve(OUTPUT_DIR, "evidence.json");
await Bun.write(evidencePath, JSON.stringify(evidence, null, 2));

console.log(`Exported ${flaggedMessages.length} flagged messages to ${evidencePath}`);
console.log(`Included ${contextMessages.length} context messages`);

const manifest = {
  generated_at: new Date().toISOString(),
  server_id: "1321966953350430740",
  message_ids: db.query("SELECT id, channel_id, author_tag, timestamp FROM messages ORDER BY timestamp").all(),
};

const manifestPath = resolve(OUTPUT_DIR, "message-manifest.json");
await Bun.write(manifestPath, JSON.stringify(manifest));

console.log(`Exported manifest with ${manifest.message_ids.length} message IDs to ${manifestPath}`);

db.close();
