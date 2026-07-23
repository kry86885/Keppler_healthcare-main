import type { User } from "../types";
import { ADMIN_PERMISSIONS, MODULE_PERMISSIONS } from "./constants";

const IST_TIMEZONE = "Asia/Kolkata";

function parseTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(" ", "T");
  const hasOffset = /([zZ]|[+-]\d{2}:\d{2})$/.test(normalized);
  const parsed = new Date(hasOffset ? normalized : `${normalized}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getISTDateKeyFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

function getISTDateTimeKeyFromDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const second = parts.find((part) => part.type === "second")?.value;
  if (!year || !month || !day || !hour || !minute || !second) return "";
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export function formatDateTimeIST(value?: string | null): string {
  if (!value) return "-";
  const parsed = parseTimestamp(value);
  if (!parsed) return "-";
  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(parsed);
  return `${formatted} IST`;
}

export function getISTDateKey(value?: string | null): string {
  if (!value) return "";
  const parsed = parseTimestamp(value);
  if (!parsed) return "";
  return getISTDateKeyFromDate(parsed);
}

export function getISTDateTimeKey(value?: string | null): string {
  if (!value) return "";
  const parsed = parseTimestamp(value);
  if (!parsed) return "";
  return getISTDateTimeKeyFromDate(parsed);
}

export function getRelativeDateLabelIST(value?: string | null): string {
  if (!value) return "Unknown Date";
  const parsed = parseTimestamp(value);
  if (!parsed) return "Unknown Date";

  const key = getISTDateKeyFromDate(parsed);
  const now = new Date();
  const todayKey = getISTDateKeyFromDate(now);
  const yesterdayKey = getISTDateKeyFromDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(parsed);
}

export function formatDateIST(value?: string | null): string {
  if (!value) return "Unknown Date";
  const parsed = parseTimestamp(value);
  if (!parsed) return "Unknown Date";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(parsed);
}

export function getTimestamp(value?: string | null): number {
  if (!value) return 0;
  const parsed = parseTimestamp(value);
  return parsed ? parsed.getTime() : 0;
}

export function stripUploadTimestampPrefix(fileName?: string | null): string {
  if (!fileName) return "";
  return fileName.replace(/^\d{8}_\d{6}_/, "");
}

export function resolvePermissions(user: User | null): string[] {
  if (!user) return [];
  if (Array.isArray(user?.permissions) && user.permissions.length > 0) {
    return user.permissions;
  }
  if (user?.user_type === "admin") {
    return ADMIN_PERMISSIONS;
  }
  const modules = Array.isArray(user?.module_access) && user.module_access.length > 0 ? user.module_access : [];
  const permissions = new Set<string>();
  for (const moduleName of modules) {
    for (const permission of MODULE_PERMISSIONS[moduleName] || []) {
      permissions.add(permission);
    }
  }
  return Array.from(permissions);
}
