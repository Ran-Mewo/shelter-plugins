type Format = {
  label: string;
  page(messages: any[], isFirstPage: boolean): string;
  wrap(channel: any, pages: Blob[]): BlobPart[];
};

const formatMessage = (message: any) => `[${new Date(message.timestamp).toLocaleString()}] ${message.author.username}: ${[message.content, ...message.attachments.map((attachment: any) => attachment.url)].filter(Boolean).join("\n")}\n`;

const prettyJson = (value: unknown, indent: string) => JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);

export const FORMATS: Record<string, Format> = {
  json: {
    label: "JSON (complete data)",
    page: (messages, isFirstPage) => (isFirstPage ? "" : ",\n") + messages.map(message => `    ${prettyJson(message, "    ")}`).join(",\n"),
    wrap: (channel, pages) => [`{\n  "channel": ${prettyJson(channel, "  ")},\n  "messages": [\n`, ...pages, "\n  ]\n}\n"],
  },
  txt: {
    label: "Text (readable)",
    page: messages => messages.map(formatMessage).join(""),
    wrap: (_, pages) => pages,
  },
};
