import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const LOG_FAMILIES = [
  "listener",
  "campaignweb",
  "flowchart",
  "platform",
  "ac_web",
] as const;

export type LogFamily = (typeof LOG_FAMILIES)[number];

const LISTENER_FILE = /^unica_aclsnr\.log(\.\d+)?$/;
const CAMPAIGN_WEB_FILE = /^campaignweb\.log(\.\d+)?$/;
const PLATFORM_FILE = /^platform\.log(\.\d+)?$/;
const AC_WEB_FILE = /^ac_web\.log(\.\d+)?$/;
const FLOWCHART_FILE = /^.+_.+_.+\.log(\.\d+)?$/;
const ROTATION = /^(.+\.log)(?:\.\d+)?$/;

const RESERVED_PARTITION_LOGS = new Set([
  "ac_web.log",
  "ac_sess.log",
  "unica_acsesutil.log",
]);

export type RecentLogFile = {
  family: LogFamily;
  fileName: string;
  path: string;
  partition: string | null;
  sizeBytes: number;
  updatedAt: string;
  ageSeconds: number;
};

export type ListRecentUnicaLogsResult = {
  withinMinutes: number;
  scannedAt: string;
  files: RecentLogFile[];
  roots: {
    campaignHome: string | null;
    campaignSharedHome: string | null;
    platformHome: string | null;
  };
  notes: string[];
};

type Candidate = RecentLogFile & { realPath: string };

const DEFAULT_LIMIT = 200;

function blank(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function baseLogName(fileName: string): string | null {
  const match = ROTATION.exec(fileName);
  return match?.[1] ?? null;
}

export function classifyCampaignHomeLog(
  fileName: string,
): "listener" | "campaignweb" | null {
  if (LISTENER_FILE.test(fileName)) return "listener";
  if (CAMPAIGN_WEB_FILE.test(fileName)) return "campaignweb";
  return null;
}

export function classifyPartitionLog(
  fileName: string,
): "ac_web" | "flowchart" | null {
  if (AC_WEB_FILE.test(fileName)) return "ac_web";
  const base = baseLogName(fileName);
  if (base == null || RESERVED_PARTITION_LOGS.has(base)) return null;
  if (FLOWCHART_FILE.test(fileName)) return "flowchart";
  return null;
}

export function classifyPlatformLog(fileName: string): "platform" | null {
  return PLATFORM_FILE.test(fileName) ? "platform" : null;
}

function isInside(root: string, target: string): boolean {
  const rootResolved = path.resolve(root);
  const targetResolved = path.resolve(target);
  if (targetResolved === rootResolved) return true;
  const prefix = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;
  return targetResolved.startsWith(prefix);
}

async function scanLogDirectory(args: {
  logsDir: string;
  root: string;
  notes: string[];
  missingNote: string;
  classify: (fileName: string) => LogFamily | null;
  partition: string | null;
  nowMs: number;
  cutoffMs: number;
  files: Candidate[];
}): Promise<void> {
  if (!isInside(args.root, args.logsDir)) {
    args.notes.push(`Skipped ${args.logsDir} because it is outside ${args.root}.`);
    return;
  }

  let logsReal: string;
  try {
    const info = await stat(args.logsDir);
    if (!info.isDirectory()) {
      args.notes.push(`${args.logsDir} is not a directory.`);
      return;
    }
    logsReal = await realpath(args.logsDir);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      args.notes.push(args.missingNote);
      return;
    }
    args.notes.push(`Could not read ${args.logsDir}.`);
    return;
  }

  let entries;
  try {
    entries = await readdir(args.logsDir, { withFileTypes: true });
  } catch {
    args.notes.push(`Could not read ${args.logsDir}.`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const family = args.classify(entry.name);
    if (family == null) continue;

    const filePath = path.join(args.logsDir, entry.name);
    let fileReal: string;
    let info;
    try {
      fileReal = await realpath(filePath);
      info = await stat(filePath);
    } catch {
      args.notes.push(`Skipped ${filePath} because it could not be read.`);
      continue;
    }

    if (!info.isFile()) continue;
    if (!isInside(logsReal, fileReal)) {
      args.notes.push(`Skipped ${filePath} because it points outside ${args.logsDir}.`);
      continue;
    }
    if (info.mtimeMs < args.cutoffMs) continue;

    const ageSeconds = Math.max(0, Math.floor((args.nowMs - info.mtimeMs) / 1000));
    args.files.push({
      family,
      fileName: entry.name,
      path: filePath,
      partition: args.partition,
      sizeBytes: info.size,
      updatedAt: info.mtime.toISOString(),
      ageSeconds,
      realPath: fileReal,
    });
  }
}

async function scanPartitions(args: {
  home: string;
  homeLabel: string;
  notes: string[];
  nowMs: number;
  cutoffMs: number;
  files: Candidate[];
}): Promise<void> {
  const partitionsDir = path.join(args.home, "partitions");
  let entries;
  try {
    const info = await stat(partitionsDir);
    if (!info.isDirectory()) {
      args.notes.push(`${partitionsDir} is not a directory.`);
      return;
    }
    entries = await readdir(partitionsDir, { withFileTypes: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      args.notes.push(
        `No partitions directory under ${args.homeLabel}. Flowchart and ac_web logs were not scanned there.`,
      );
      return;
    }
    args.notes.push(`Could not read ${partitionsDir}.`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    await scanLogDirectory({
      logsDir: path.join(partitionsDir, entry.name, "logs"),
      root: args.home,
      notes: args.notes,
      missingNote: `No logs directory for ${entry.name} under ${args.homeLabel}.`,
      classify: classifyPartitionLog,
      partition: entry.name,
      nowMs: args.nowMs,
      cutoffMs: args.cutoffMs,
      files: args.files,
    });
  }
}

async function acceptHome(
  label: string,
  value: string | null,
  notes: string[],
): Promise<string | null> {
  if (value == null) return null;
  if (!path.isAbsolute(value)) {
    notes.push(`${label} must be an absolute path.`);
    return null;
  }
  try {
    const info = await stat(value);
    if (!info.isDirectory()) {
      notes.push(`${label} is not a directory: ${value}`);
      return null;
    }
  } catch {
    notes.push(`${label} does not exist: ${value}`);
    return null;
  }
  return value;
}

export async function listRecentUnicaLogs(options: {
  campaignHome?: string | null;
  campaignSharedHome?: string | null;
  platformHome?: string | null;
  withinMinutes: number;
  now?: Date;
  limit?: number;
}): Promise<ListRecentUnicaLogsResult> {
  if (
    !Number.isInteger(options.withinMinutes) ||
    options.withinMinutes < 1 ||
    options.withinMinutes > 1440
  ) {
    throw new Error("withinMinutes must be an integer from 1 to 1440.");
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer.");
  }

  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const cutoffMs = nowMs - options.withinMinutes * 60_000;
  const notes: string[] = [];
  const files: Candidate[] = [];

  const campaignHome = await acceptHome(
    "UNICA_CAMPAIGN_HOME",
    blank(options.campaignHome),
    notes,
  );
  const campaignSharedHome = await acceptHome(
    "UNICA_CAMPAIGN_SHARED_HOME",
    blank(options.campaignSharedHome),
    notes,
  );
  const platformHome = await acceptHome(
    "UNICA_PLATFORM_HOME",
    blank(options.platformHome),
    notes,
  );

  if (campaignHome == null && blank(options.campaignHome) == null) {
    notes.push(
      "Set UNICA_CAMPAIGN_HOME to the Campaign installation path to scan listener, campaignweb, flowchart, and ac_web logs.",
    );
  }

  if (platformHome == null && blank(options.platformHome) == null) {
    notes.push(
      "Set UNICA_PLATFORM_HOME to the Platform installation path to scan platform.log.",
    );
  }

  if (campaignHome != null) {
    await scanLogDirectory({
      logsDir: path.join(campaignHome, "logs"),
      root: campaignHome,
      notes,
      missingNote: `No logs directory under ${campaignHome}. Listener and campaignweb logs were not scanned there.`,
      classify: classifyCampaignHomeLog,
      partition: null,
      nowMs,
      cutoffMs,
      files,
    });
    await scanPartitions({
      home: campaignHome,
      homeLabel: campaignHome,
      notes,
      nowMs,
      cutoffMs,
      files,
    });
  }

  if (campaignSharedHome != null) {
    let sameAsCampaign = false;
    if (campaignHome != null) {
      try {
        sameAsCampaign =
          (await realpath(campaignSharedHome)) === (await realpath(campaignHome));
      } catch {
        sameAsCampaign = path.resolve(campaignSharedHome) === path.resolve(campaignHome);
      }
    }
    if (sameAsCampaign) {
      notes.push(
        "UNICA_CAMPAIGN_SHARED_HOME matches UNICA_CAMPAIGN_HOME. Partitions were scanned once.",
      );
    } else {
      await scanPartitions({
        home: campaignSharedHome,
        homeLabel: campaignSharedHome,
        notes,
        nowMs,
        cutoffMs,
        files,
      });
    }
  }

  if (platformHome != null) {
    await scanLogDirectory({
      logsDir: path.join(platformHome, "logs"),
      root: platformHome,
      notes,
      missingNote: `No logs directory under ${platformHome}. platform.log was not scanned there.`,
      classify: classifyPlatformLog,
      partition: null,
      nowMs,
      cutoffMs,
      files,
    });
  }

  const seen = new Set<string>();
  const unique: RecentLogFile[] = [];
  const ordered = files.sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    if (a.family !== b.family) return a.family < b.family ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  for (const file of ordered) {
    if (seen.has(file.realPath)) continue;
    seen.add(file.realPath);
    unique.push({
      family: file.family,
      fileName: file.fileName,
      path: file.path,
      partition: file.partition,
      sizeBytes: file.sizeBytes,
      updatedAt: file.updatedAt,
      ageSeconds: file.ageSeconds,
    });
  }

  const truncated = unique.length > limit;
  if (truncated) {
    notes.push(`Stopped after ${limit} files. Narrow the window to see the rest.`);
  }

  return {
    withinMinutes: options.withinMinutes,
    scannedAt: now.toISOString(),
    files: unique.slice(0, limit),
    roots: {
      campaignHome,
      campaignSharedHome,
      platformHome,
    },
    notes,
  };
}
