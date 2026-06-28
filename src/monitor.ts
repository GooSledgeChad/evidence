import { Client, Intents } from "discord.js-selfbot-v13";
import { resolve } from "path";
import { createHash } from "crypto";

const REPO_DIR = resolve(import.meta.dir, "..");
const LOGS_DIR = resolve(REPO_DIR, "logs");
const DATA_DIR = resolve(REPO_DIR, "data");
const GUILD_ID = process.env.GUILD_ID ?? "1321966953350430740";
const PUSH_BRANCH = process.env.TAMPER_BRANCH ?? "tamper-log";
const TEST_MODE = process.env.TEST_MODE === "true";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "GooSledgeChad/evidence";
const WEB_PORT = parseInt(process.env.WEB_PORT ?? "3000");

const manifestPath = resolve(DATA_DIR, "message-manifest.json");
const manifestFile = Bun.file(manifestPath);

let trackedMessageIds: Set<string>;

if (TEST_MODE) {
  trackedMessageIds = new Set();
  console.log("Running in TEST MODE — all messages treated as tracked");
} else {
  if (!(await manifestFile.exists())) {
    console.error("No message manifest found. Run `bun run export-evidence` first.");
    process.exit(1);
  }
  const manifest = await manifestFile.json();
  trackedMessageIds = new Set(manifest.message_ids.map((m: any) => m.id));
}

console.log(`Loaded manifest: tracking ${TEST_MODE ? "ALL (test)" : trackedMessageIds.size} messages`);

interface TamperEvent {
  type: "message_deleted" | "message_edited" | "bulk_delete" | "channel_deleted" | "channel_updated" | "role_deleted" | "guild_updated";
  timestamp: string;
  details: Record<string, any>;
  hash: string;
  previous_hash: string;
}

let previousHash = "GENESIS";
let eventCount = 0;
let pendingPush = false;

interface WebEvent {
  type: string;
  timestamp: string;
  summary: string;
  commitSha: string | null;
  commitUrl: string | null;
}

const recentEvents: WebEvent[] = [];

async function getLogFile(): Promise<string> {
  const date = new Date().toISOString().split("T")[0];
  return resolve(LOGS_DIR, `tamper-log-${date}.jsonl`);
}

async function gitPush(commitMessage: string, eventTimestamp?: string) {
  if (pendingPush) return;
  pendingPush = true;

  setTimeout(async () => {
    try {
      await Bun.$`git -C ${REPO_DIR} add -f logs/`.quiet();
      const status = await Bun.$`git -C ${REPO_DIR} status --porcelain logs/`.text();
      if (!status.trim()) {
        pendingPush = false;
        return;
      }
      await Bun.$`git -C ${REPO_DIR} commit -m ${commitMessage}`.quiet();
      const sha = (await Bun.$`git -C ${REPO_DIR} rev-parse HEAD`.text()).trim();
      try {
        const pushOut = await Bun.$`git -C ${REPO_DIR} push origin ${PUSH_BRANCH} 2>&1`.text();
        console.log(`[git] Push output: ${pushOut.trim()}`);
      } catch (pushErr: any) {
        throw new Error(`push failed: ${pushErr.stderr?.toString() || pushErr.stdout?.toString() || pushErr.message}`);
      }
      console.log(`[git] Pushed to ${PUSH_BRANCH}: ${commitMessage} (${sha.slice(0, 7)})`);

      const type = commitMessage.startsWith("heartbeat:") ? "heartbeat" : "tamper";
      addWebEvent({
        type,
        timestamp: eventTimestamp ?? new Date().toISOString(),
        summary: commitMessage,
        commitSha: sha,
        commitUrl: `https://github.com/${GITHUB_REPO}/commit/${sha}`,
      });
    } catch (e: any) {
      console.error(`[git] Push failed: ${e.message}`);
    }
    pendingPush = false;
  }, 10_000);
}

function addWebEvent(event: WebEvent) {
  recentEvents.unshift(event);
  if (recentEvents.length > 200) recentEvents.length = 200;
}

async function logEvent(event: Omit<TamperEvent, "hash" | "previous_hash">) {
  const entry: TamperEvent = {
    ...event,
    previous_hash: previousHash,
    hash: "",
  };

  const payload = JSON.stringify({ ...entry, hash: undefined });
  entry.hash = createHash("sha256").update(payload + previousHash).digest("hex");
  previousHash = entry.hash;
  eventCount++;

  const logFile = await getLogFile();
  const line = JSON.stringify(entry) + "\n";
  await Bun.write(logFile, (await Bun.file(logFile).exists() ? await Bun.file(logFile).text() : "") + line);

  console.log(`[${event.timestamp}] ${event.type}: ${JSON.stringify(event.details).slice(0, 120)}`);

  const trackedAffected =
    event.details.was_in_archive ||
    event.details.tracked_count > 0 ||
    event.type === "channel_deleted" ||
    event.type === "guild_updated";

  if (trackedAffected) {
    const summary = event.type === "bulk_delete"
      ? `${event.details.tracked_count} archived messages bulk-deleted`
      : event.type === "message_deleted" && event.details.was_in_archive
        ? `archived message deleted: ${event.details.message_id}`
        : `${event.type}: ${event.details.channel_name ?? event.details.old_name ?? "server"}`;
    await gitPush(`tamper: ${summary}`, event.timestamp);
  }
}

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.MESSAGE_CONTENT,
  ],
});

client.once("ready", async () => {
  console.log(`Monitor online as ${client.user?.tag}`);
  console.log(`Watching guild: ${GUILD_ID}`);
  console.log(`Tracking ${TEST_MODE ? "ALL (test mode)" : trackedMessageIds.size} archived messages`);
  console.log(`Pushing to branch: ${PUSH_BRANCH}`);
  console.log(`Logs: ${LOGS_DIR}`);

  try {
    const branch = (await Bun.$`git -C ${REPO_DIR} branch --show-current`.text()).trim();
    if (branch !== PUSH_BRANCH) {
      await Bun.$`git -C ${REPO_DIR} checkout ${PUSH_BRANCH}`.quiet();
    }
    await Bun.$`git -C ${REPO_DIR} branch --set-upstream-to=origin/${PUSH_BRANCH} ${PUSH_BRANCH}`.quiet();
    console.log(`[git] On branch ${PUSH_BRANCH} (tracking origin/${PUSH_BRANCH})`);
  } catch (e: any) {
    console.error(`[git] Branch setup error: ${e.message}`);
  }
});

client.on("messageDelete", async (message) => {
  if (message.guildId !== GUILD_ID) return;

  await logEvent({
    type: "message_deleted",
    timestamp: new Date().toISOString(),
    details: {
      message_id: message.id,
      channel_id: message.channelId,
      channel_name: "name" in message.channel ? (message.channel as any).name : undefined,
      author_id: message.author?.id,
      author_tag: message.author?.username,
      content: message.content ?? "[uncached]",
      was_in_archive: TEST_MODE || trackedMessageIds.has(message.id),
      original_timestamp: message.createdAt?.toISOString(),
    },
  });
});

client.on("messageDeleteBulk", async (messages, channel) => {
  if (!("guildId" in channel) || (channel as any).guildId !== GUILD_ID) return;

  const deleted = messages.map((m) => ({
    id: m.id,
    author: m.author?.username,
    content: m.content?.slice(0, 200) ?? "[uncached]",
    was_in_archive: TEST_MODE || trackedMessageIds.has(m.id),
  }));

  const trackedCount = deleted.filter((d) => d.was_in_archive).length;

  await logEvent({
    type: "bulk_delete",
    timestamp: new Date().toISOString(),
    details: {
      channel_id: channel.id,
      channel_name: "name" in channel ? (channel as any).name : undefined,
      count: messages.size,
      tracked_count: trackedCount,
      messages: deleted,
    },
  });
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (newMessage.guildId !== GUILD_ID) return;

  const wasTracked = trackedMessageIds.has(newMessage.id);
  if (!wasTracked && oldMessage.content === newMessage.content) return;

  await logEvent({
    type: "message_edited",
    timestamp: new Date().toISOString(),
    details: {
      message_id: newMessage.id,
      channel_id: newMessage.channelId,
      author_id: newMessage.author?.id,
      author_tag: newMessage.author?.username,
      old_content: oldMessage.content ?? "[uncached]",
      new_content: newMessage.content ?? "[uncached]",
      was_in_archive: wasTracked,
    },
  });
});

client.on("channelDelete", async (channel) => {
  if (!("guildId" in channel) || (channel as any).guildId !== GUILD_ID) return;

  await logEvent({
    type: "channel_deleted",
    timestamp: new Date().toISOString(),
    details: {
      channel_id: channel.id,
      channel_name: "name" in channel ? (channel as any).name : undefined,
      channel_type: channel.type,
    },
  });
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
  if (!("guildId" in newChannel) || (newChannel as any).guildId !== GUILD_ID) return;

  const oldName = "name" in oldChannel ? (oldChannel as any).name : undefined;
  const newName = "name" in newChannel ? (newChannel as any).name : undefined;

  await logEvent({
    type: "channel_updated",
    timestamp: new Date().toISOString(),
    details: {
      channel_id: newChannel.id,
      old_name: oldName,
      new_name: newName,
      type: newChannel.type,
    },
  });
});

client.on("guildUpdate", async (oldGuild, newGuild) => {
  if (newGuild.id !== GUILD_ID) return;

  await logEvent({
    type: "guild_updated",
    timestamp: new Date().toISOString(),
    details: {
      old_name: oldGuild.name,
      new_name: newGuild.name,
      verification_level_changed: oldGuild.verificationLevel !== newGuild.verificationLevel,
      new_verification_level: newGuild.verificationLevel,
    },
  });
});

setInterval(async () => {
  const logFile = await getLogFile();
  const ts = new Date().toISOString();
  const heartbeat = JSON.stringify({
    type: "heartbeat",
    timestamp: ts,
    events_logged: eventCount,
    chain_hash: previousHash,
  }) + "\n";
  await Bun.write(logFile, (await Bun.file(logFile).exists() ? await Bun.file(logFile).text() : "") + heartbeat);
  await gitPush(`heartbeat: ${eventCount} events, chain ${previousHash.slice(0, 12)}`, ts);
}, 60 * 60 * 1000);

// Load past commits from git log on startup
async function loadPastCommits() {
  try {
    const log = await Bun.$`git -C ${REPO_DIR} log ${PUSH_BRANCH} --format=%H%x09%aI%x09%s -100`.text();
    for (const line of log.trim().split("\n").reverse()) {
      if (!line.trim()) continue;
      const [sha, date, ...rest] = line.split("\t");
      const msg = rest.join("\t");
      if (!msg.startsWith("tamper:") && !msg.startsWith("heartbeat:")) continue;
      addWebEvent({
        type: msg.startsWith("heartbeat:") ? "heartbeat" : "tamper",
        timestamp: date,
        summary: msg,
        commitSha: sha,
        commitUrl: `https://github.com/${GITHUB_REPO}/commit/${sha}`,
      });
    }
    console.log(`[web] Loaded ${recentEvents.length} past events from git log`);
  } catch {
    console.log("[web] No past commits found on tamper-log branch");
  }
}

function renderDashboard(): string {
  const tamperEvents = recentEvents.filter((e) => e.type === "tamper");
  const heartbeats = recentEvents.filter((e) => e.type === "heartbeat");
  const lastHeartbeat = heartbeats[0];

  const eventsHtml = tamperEvents.length === 0
    ? `<p class="empty">No tampering detected yet.</p>`
    : tamperEvents.map((e) => {
      const date = new Date(e.timestamp);
      const ago = timeAgo(date);
      const shortSha = e.commitSha?.slice(0, 7) ?? "—";
      return `<div class="event">
        <div class="event-header">
          <span class="event-type">${esc(e.type)}</span>
          <time datetime="${esc(e.timestamp)}" title="${esc(e.timestamp)}">${ago}</time>
        </div>
        <p class="event-summary">${esc(e.summary.replace(/^tamper:\s*/, ""))}</p>
        ${e.commitUrl ? `<a class="commit-link" href="${esc(e.commitUrl)}" target="_blank" rel="noopener">${shortSha} — view on GitHub</a>` : ""}
      </div>`;
    }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tamper Monitor — Live</title>
  <meta http-equiv="refresh" content="60">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0e0e0e;
      color: #d4d4d4;
      padding: 2rem;
      max-width: 720px;
      margin: 0 auto;
      line-height: 1.6;
    }
    h1 { color: #e4e4e4; font-size: 1.3rem; margin-bottom: 0.25rem; }
    .status { font-size: 0.85rem; color: #666; margin-bottom: 1.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid #1e1e1e; }
    .status .online { color: #4ade80; }
    .stats { display: flex; gap: 2rem; margin-bottom: 1.5rem; }
    .stat { text-align: center; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: #e4e4e4; }
    .stat-value.danger { color: #f87171; }
    .stat-label { font-size: 0.7rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
    h2 { color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.75rem; }
    .event { background: #161616; border: 1px solid #222; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
    .event-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; }
    .event-type { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #f87171; font-weight: 600; }
    time { font-size: 0.75rem; color: #555; }
    .event-summary { font-size: 0.85rem; color: #bbb; }
    .commit-link { font-size: 0.75rem; color: #7aa2f7; text-decoration: none; font-family: monospace; }
    .commit-link:hover { text-decoration: underline; }
    .empty { color: #555; font-style: italic; }
    .repo-link { font-size: 0.8rem; color: #7aa2f7; text-decoration: none; }
    .repo-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Tamper Monitor</h1>
  <div class="status">
    <span class="online">● Online</span> — watching TheSwiftCheetahs
    ${lastHeartbeat ? ` · last heartbeat ${timeAgo(new Date(lastHeartbeat.timestamp))}` : ""}
    · <a class="repo-link" href="https://github.com/${esc(GITHUB_REPO)}/tree/${esc(PUSH_BRANCH)}" target="_blank" rel="noopener">view full log on GitHub</a>
  </div>
  <div class="stats">
    <div class="stat">
      <div class="stat-value${tamperEvents.length > 0 ? " danger" : ""}">${tamperEvents.length}</div>
      <div class="stat-label">tamper events</div>
    </div>
    <div class="stat">
      <div class="stat-value">${heartbeats.length}</div>
      <div class="stat-label">heartbeats</div>
    </div>
  </div>
  <h2>Recent Changes</h2>
  ${eventsHtml}
</body>
</html>`;
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

await loadPastCommits();

Bun.serve({
  port: WEB_PORT,
  routes: {
    "/": () => new Response(renderDashboard(), { headers: { "Content-Type": "text/html" } }),
    "/api/events": () => Response.json(recentEvents),
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`[web] Dashboard running on http://localhost:${WEB_PORT}`);

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("Set DISCORD_TOKEN in .env");
  process.exit(1);
}

client.login(token);
