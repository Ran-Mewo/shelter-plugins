const { http, util: { sleep } } = shelter;

const MAX_RETRIES = 5;

async function get(url: string, query?: object) {
  await http.ready;
  for (let failures = 0; ; ) {
    try {
      const { body, headers } = await http.get!({ url, query });
      if (headers["x-ratelimit-remaining"] === "0") await sleep(Number(headers["x-ratelimit-reset-after"]) * 1000);
      return body;
    } catch (error: any) {
      const isRateLimit = error?.status === 429;
      if (!isRateLimit && (error?.status < 500 || ++failures > MAX_RETRIES)) throw error;
      await sleep((isRateLimit ? error.body?.retry_after ?? 1 : failures * 2) * 1000);
    }
  }
}

export const getChannel = (channelId: string) => get(`/channels/${channelId}`);

export async function* getMessagesOldestFirst(channelId: string): AsyncGenerator<any[]> {
  for (let after = "0"; ; ) {
    const page: any[] = await get(`/channels/${channelId}/messages`, { limit: 100, after });
    if (!page.length) return;
    page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    yield page;
    after = page[page.length - 1].id;
  }
}
