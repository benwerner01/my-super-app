/**
 * A reader for the subset of the XML property-list format that launchd agents
 * use. Shelling out to `plutil` would be simpler, but the dashboard is not
 * allowed to execute anything — it only ever reads files.
 */
export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

type Cursor = { xml: string; at: number };

type Tag = { name: string; closing: boolean; selfClosing: boolean; end: number };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gu, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? whole;
  });
}

function nextTag(cursor: Cursor): Tag | null {
  for (;;) {
    const open = cursor.xml.indexOf("<", cursor.at);
    if (open === -1) return null;
    const close = cursor.xml.indexOf(">", open);
    if (close === -1) return null;
    const raw = cursor.xml.slice(open + 1, close);
    cursor.at = close + 1;
    // skip declarations, doctypes and comments
    if (raw.startsWith("?") || raw.startsWith("!")) continue;
    const closing = raw.startsWith("/");
    const selfClosing = raw.endsWith("/");
    const name = raw.replace(/^\//u, "").replace(/\/$/u, "").trim().split(/\s/u)[0] ?? "";
    return { name: name.toLowerCase(), closing, selfClosing, end: close + 1 };
  }
}

function readText(cursor: Cursor, tag: string): string {
  const close = cursor.xml.indexOf(`</${tag}`, cursor.at);
  if (close === -1) {
    cursor.at = cursor.xml.length;
    return "";
  }
  const text = cursor.xml.slice(cursor.at, close);
  const after = cursor.xml.indexOf(">", close);
  cursor.at = after === -1 ? cursor.xml.length : after + 1;
  return decode(text);
}

function parseValue(cursor: Cursor, tag: Tag): PlistValue | null {
  switch (tag.name) {
    case "true":
      return true;
    case "false":
      return false;
    case "string":
    case "date":
    case "data":
      return tag.selfClosing ? "" : readText(cursor, tag.name).trim();
    case "integer":
    case "real": {
      const value = tag.selfClosing ? "" : readText(cursor, tag.name).trim();
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case "array": {
      const items: PlistValue[] = [];
      if (tag.selfClosing) return items;
      for (;;) {
        const next = nextTag(cursor);
        if (!next || (next.closing && next.name === "array")) return items;
        const value = parseValue(cursor, next);
        if (value !== null) items.push(value);
      }
    }
    case "dict": {
      const entries: Record<string, PlistValue> = {};
      if (tag.selfClosing) return entries;
      for (;;) {
        const next = nextTag(cursor);
        if (!next || (next.closing && next.name === "dict")) return entries;
        if (next.name !== "key" || next.closing) continue;
        const key = next.selfClosing ? "" : readText(cursor, "key").trim();
        const valueTag = nextTag(cursor);
        if (!valueTag) return entries;
        const value = parseValue(cursor, valueTag);
        if (value !== null) entries[key] = value;
      }
    }
    default:
      return null;
  }
}

/** Returns the plist's root value, or null if the document is not readable. */
export function parsePlist(xml: string): PlistValue | null {
  const cursor: Cursor = { xml, at: 0 };
  for (;;) {
    const tag = nextTag(cursor);
    if (!tag) return null;
    if (tag.closing) continue;
    if (tag.name === "plist") continue;
    return parseValue(cursor, tag);
  }
}

export function asDict(value: PlistValue | null | undefined): Record<string, PlistValue> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}
