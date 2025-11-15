import type { MediaEntry, Message } from "./types";

function getFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    const segments = path.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : url;
  } catch {
    return url;
  }
}

export function collectMediaFromMessage(message: Message | undefined | null): MediaEntry[] {
  if (!message) return [];

  const results: MediaEntry[] = [];
  const seen = new Set<string>();

  const stripDiscordExpiration = (raw?: string | null) => {
    if (!raw) return undefined;
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname;
      if (host.endsWith("discordapp.com") || host.endsWith("discordapp.net") || host.endsWith("discord.com")) {
        parsed.search = "";
        parsed.hash = "";
      }
      return parsed.toString();
    } catch {
      return raw;
    }
  };

  const pushEntry = (entry: MediaEntry | undefined) => {
    if (!entry) return;
    if (!entry.url || !entry.src) return;
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    results.push(entry);
  };

  for (const embed of message.embeds ?? []) {
    const video = embed.video ?? {};
    const image = embed.image ?? {};
    const thumbnail = embed.thumbnail ?? {};
    
    const url = stripDiscordExpiration(embed.url ?? video.url ?? thumbnail.url);
    const src = image.proxyURL ?? video.proxyURL ?? thumbnail.proxyURL ?? embed.url;
    if (!url || !src) continue;
    const contentType = image.contentType ?? video.contentType ?? thumbnail.contentType ?? "";
    pushEntry({
      url,
      src,
      width: image.width ?? video.width ?? thumbnail.width ?? 0,
      height: image.height ?? video.height ?? thumbnail.height ?? 0,
      format: src === video.proxyURL ? 2 : 1,
      isVideo: contentType.includes("video"),
      isEmbedGif: contentType.includes("gif"),
      name: getFilename(url),
    });
  }

  for (const attachment of message.attachments ?? []) {
    const url = stripDiscordExpiration(attachment.url);
    const src = attachment.proxy_url ?? attachment.url;
    if (!url || !src) continue;
    const isVideo = attachment.content_type?.includes("video") ?? false;
    pushEntry({
      url,
      src,
      width: attachment.width ?? attachment.resolved_width ?? attachment.dimensions?.width ?? 0,
      height: attachment.height ?? attachment.resolved_height ?? attachment.dimensions?.height ?? 0,
      format: isVideo ? 2 : 1,
      isVideo,
      name: attachment.filename ?? getFilename(url),
    });
  }

  return results;
}
