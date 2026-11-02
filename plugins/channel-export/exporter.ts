import { getChannel, getMessagesOldestFirst } from "./fetching";
import { FORMATS } from "./formats";

const { solid: { createSignal }, ui: { showToast } } = shelter;

const [exportStatus, setExportStatus] = createSignal<{ name: string; messageCount: number; progress: number; stopping?: boolean } | null>(null);
export { exportStatus };

export const stopExport = () => setExportStatus(status => status && { ...status, stopping: true });

function download(parts: BlobPart[], filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(parts));
  link.download = filename.replace(/[\\/:*?"<>|]/g, "_");
  link.click();
  // revoking right away can cancel the download in Firefox
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

export async function startExport(channelId: string, { formatId, ignoreHumans, ignoreApps }: { formatId: string; ignoreHumans?: boolean; ignoreApps?: boolean }) {
  if (exportStatus()) return;
  const format = FORMATS[formatId];
  const pages: Blob[] = [];
  let channel: any, error: any, oldestId: string | undefined, name = channelId, messageCount = 0;
  setExportStatus({ name, messageCount, progress: 0 });

  try {
    channel = await getChannel(channelId);
    name = channel.name || channel.recipients?.map((user: any) => user.username).join(", ") || channelId;
    for await (const page of getMessagesOldestFirst(channelId)) {
      oldestId ??= page[0].id;
      const kept = page.filter(message => !(message.author.bot ? ignoreApps : ignoreHumans));
      if (kept.length) pages.push(new Blob([format.page(kept, !messageCount)]));
      messageCount += kept.length;
      // message ids grow with time, so the last id's place between the oldest and newest ids is the progress
      const progress = (Number(page[page.length - 1].id) - Number(oldestId)) / (Number(channel.last_message_id) - Number(oldestId) || 1);
      setExportStatus(status => status && { ...status, name, messageCount, progress: Math.min(progress, 1) });
      if (exportStatus()?.stopping) break;
    }
  } catch (caught) {
    error = caught;
    console.error("[channel-export]", caught);
  }

  const stopped = exportStatus()?.stopping;
  setExportStatus(null);
  if (messageCount) download(format.wrap(channel, pages), `${name} (${channelId})${error || stopped ? " (partial)" : ""}.${formatId}`);
  const reason = error ? `${error.body?.message ?? error.message ?? "Request failed"}. ` : "";
  showToast({ title: `Channel export ${error ? "failed" : stopped ? "stopped" : "finished"}`, content: `${reason}Saved ${messageCount.toLocaleString()} messages from ${name}.` });
}
