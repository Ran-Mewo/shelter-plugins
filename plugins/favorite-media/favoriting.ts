import type { FavoriteGifEntry, FavoriteGifsState, MediaEntry } from "./types";

const {
  flux,
  http,
} = shelter;

const dispatcher = flux.dispatcher;

type ProtoModule = typeof import("discord-protos/dist/discord_protos/discord_users/v1/FrecencyUserSettings.js");

let protoModulePromise: Promise<ProtoModule> | null = null;

async function loadProtoModule(): Promise<ProtoModule> {
  protoModulePromise ??= (async () => {
    await import("discord-protos/dist/index.js");
    return import("discord-protos/dist/discord_protos/discord_users/v1/FrecencyUserSettings.js");
  })();
  return protoModulePromise;
}

const UserSettingsProtoStore = flux.stores?.UserSettingsProtoStore as
  | {
      frecencyWithoutFetchingLatest?: {
        favoriteGifs?: FavoriteGifsState;
      };
    }
  | undefined;

const FAVORITE_PROTO_ENDPOINT = "/users/@me/settings-proto/2";

export function getFavoritesState(): FavoriteGifsState {
  const storeState = UserSettingsProtoStore?.frecencyWithoutFetchingLatest?.favoriteGifs;
  return {
    gifs: { ...(storeState?.gifs ?? {}) },
    hideTooltip: Boolean(storeState?.hideTooltip),
  };
}

function dispatchLocalUpdate(gifs: Record<string, FavoriteGifEntry>, hideTooltip: boolean) {
  dispatcher.dispatch({
    type: "USER_SETTINGS_PROTO_UPDATE",
    settings: {
      type: 2,
      proto: {
        favoriteGifs: {
          gifs,
          hideTooltip,
        },
      },
    },
    partial: true,
    local: true,
  });
}

async function patchFavorites(gifs: Record<string, FavoriteGifEntry>, hideTooltip: boolean) {
  const { FrecencyUserSettings } = await loadProtoModule();
  const message = FrecencyUserSettings.create(UserSettingsProtoStore?.frecencyWithoutFetchingLatest ?? {});
  message.favoriteGifs = { gifs: Object.fromEntries(Object.entries(gifs).map(([url, entry]) => [url, { ...entry }])), hideTooltip };
  await http!.patch!({
    url: FAVORITE_PROTO_ENDPOINT,
    body: { settings: FrecencyUserSettings.toBase64(message) },
    oldFormErrors: false,
  });
}

export async function addFavoriteMedia(media: MediaEntry) {
  const current = getFavoritesState();
  if (current.gifs[media.url]) return;

  const nextGifs = {
    ...current.gifs,
    [media.url]: {
      format: media.format,
      src: media.src,
      url: media.url,
      width: media.width ?? 320,
      height: media.height ?? 180,
      order: Math.max(...Object.values(current.gifs).map((gif) => gif.order ?? 0)) + 1,
    },
  };

  const nextHideTooltip = Object.keys(nextGifs).length > 2;
  dispatchLocalUpdate(nextGifs, nextHideTooltip);

  try {
    await patchFavorites(nextGifs, nextHideTooltip);
  } catch (error) {
    console.warn("[favorite-media] Failed to persist favorite GIFs", error);
    dispatchLocalUpdate(current.gifs, current.hideTooltip ?? false);
    throw error;
  }
}

export async function removeFavoriteMedia(url: string) {
  const current = getFavoritesState();
  if (!current.gifs[url]) return;

  const nextGifs = { ...current.gifs };
  delete nextGifs[url];
  const nextHideTooltip = Object.keys(nextGifs).length > 2;

  dispatchLocalUpdate(nextGifs, nextHideTooltip);

  try {
    await patchFavorites(nextGifs, nextHideTooltip);
  } catch (error) {
    console.warn("[favorite-media] Failed to persist favorite GIF removal", error);
    dispatchLocalUpdate(current.gifs, current.hideTooltip ?? false);
    throw error;
  }
}
