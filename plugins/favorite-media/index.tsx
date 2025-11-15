// this is such slop
import { collectMediaFromMessage } from "./media";
import { addFavoriteMedia, getFavoritesState, removeFavoriteMedia } from "./favoriting";
import type { MediaEntry } from "./types";

const { plugin, util: { getFiber, reactFiberWalker } } = shelter;
const scoped = plugin.scoped;

type AccessoryState = {
  container: HTMLElement;
  overlay: HTMLElement | null;
  entry: MediaEntry;
  pending: boolean;
  queuedToggles: number;
  nativeObserver: MutationObserver | null;
};

const accessoryStates = new Set<AccessoryState>();
let stopObserve, unsubscribe, removeCss;

const MEDIA_SELECTOR = [
  'div[class*="imageWrapper"]', 'div[class*="videoWrapper"]', 'div[class*="videoControls"]',
  'div[class*="imageContent"]', 'div[class*="attachmentInner"]', 'div[class*="messageAttachmentMedia"]',
  'div[class*="mediaAttachments"]'
].map(s => `${s} img[src], ${s} video`).join(", ");

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    url.search = url.hash = "";
    return url.toString();
  } catch {
    return value.split("?")[0].split("#")[0];
  }
}

function getMessageForElement(node) {
  const fiber = getFiber(node);
  const messageFiber = fiber && reactFiberWalker(fiber, 
    c => c?.memoizedProps?.message ?? c?.pendingProps?.message, true);
  const props = messageFiber?.memoizedProps ?? messageFiber?.pendingProps ?? {};
  return props.message ?? props.childrenProps?.message ?? null;
}

function gatherElementSources(element) {
  const sources = new Set();
  const add = val => { const n = normalizeUrl(val); if (n) sources.add(n); };

  if (element instanceof HTMLImageElement) {
    [element.currentSrc, element.src, element.dataset.src].forEach(add);
  } else if (element instanceof HTMLVideoElement) {
    [element.currentSrc, element.src, element.poster].forEach(add);
    Array.from(element.querySelectorAll("source[src]")).forEach(s => add((s as HTMLSourceElement).src));
  }

  Object.values(element.dataset || {}).forEach(add);
  ["src", "data-src", "href"].forEach(attr => add(element.getAttribute(attr)));
  
  const anchor = element.closest("a[href]");
  if (anchor) add(anchor.href);

  return Array.from(sources);
}

function findMatchingEntry(element, container, message) {
  const mediaList = collectMediaFromMessage(message);
  if (!mediaList.length) return mediaList.length === 1 ? mediaList[0] : null;

  const sources = new Set([...gatherElementSources(element), ...gatherElementSources(container)]);
  return mediaList.find(e => 
    sources.has(normalizeUrl(e.url)) || sources.has(normalizeUrl(e.src))
  ) || null;
}

function getMediaContainer(element) {
  return element.closest([
    'div[class*="imageWrapper"]', 'div[class*="videoControls"]', 'div[class*="videoWrapper"]',
    'div[class*="imageContent"]', 'div[class*="gifCanvas"]', 'div[class*="attachmentInner"]',
    'div[class*="messageAttachmentMedia"]', 'figure[class*="attachment"]', 'div[class*="galleryItem"]'
  ].join(","));
}

function hideNativeGifButton(container: HTMLElement) {
  const findHost = () => {
    const accessory = container.querySelector('div[class*="imageAccessory"]');
    const target = accessory?.querySelector('[role="button"][tabindex]');
    if (!(target instanceof HTMLElement)) return null;
    const host = target.parentElement instanceof HTMLElement ? target.parentElement : target;
    return host.querySelector("svg") ? host : null;
  };

  const hideHost = () => {
    const host = findHost();
    if (host) host.style.display = "none";
  };

  const observer = new MutationObserver(hideHost);
  observer.observe(container, { childList: true, subtree: true });
  hideHost();
  return observer;
}

function disposeAccessoryState(state: AccessoryState) {
  state.overlay?.remove();
  state.nativeObserver?.disconnect();
  delete state.container.dataset.favoriteMediaAccessory;
  accessoryStates.delete(state);
}

function updateAccessoryState(state) {
  if (!state.overlay) return;
  const isFavorite = Boolean(getFavoritesState().gifs[state.entry.url]);
  const action = isFavorite ? "Remove" : "Add";
  const preposition = isFavorite ? "from" : "to";
  const title = `${action} ${state.entry.name || state.entry.url} ${preposition} favorites`;
  state.overlay.dataset.favorite = String(isFavorite);
  state.overlay.title = state.overlay.ariaLabel = title;
  state.overlay.ariaPressed = String(isFavorite);
}

async function toggleFavorite(state) {
  if (state.pending || !state.overlay) return state.queuedToggles++;
  state.pending = true;

  try {
    const isFavorite = Boolean(getFavoritesState().gifs[state.entry.url]);
    await (isFavorite ? removeFavoriteMedia(state.entry.url) : addFavoriteMedia(state.entry));
    if (!isFavorite && state.overlay) state.overlay.dataset.pulse = "true";
  } catch (error) {
    console.warn("[favorite-media] Failed to update favorites", error);
  } finally {
    state.pending = false;
    state.queuedToggles > 0 ? (state.queuedToggles--, queueMicrotask(() => toggleFavorite(state))) : refreshAllAccessories();
  }
}

function createOverlay(state) {
  if (window.getComputedStyle(state.container).position === "static") state.container.style.position = "relative";

  const overlay = document.createElement("div");
  overlay.className = "favorite-media-accessory";
  overlay.role = "button";
  overlay.tabIndex = 0;
  overlay.dataset.pulse = "false";
  
  const hollowStar = '<svg class="favorite-media-icon favorite-media-icon-hollow" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M2.07 10.94a1.25 1.25 0 0 1 .73-2.25h6.12l1.9-5.83c.37-1.15 2-1.15 2.37 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82a1.25 1.25 0 0 1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6Zm11.55-.25h5.26l-4.25 3.09 1.62 5-4.25-3.1-4.25 3.1 1.62-5-4.25-3.1h5.26l1.62-5 1.62 5Z" clip-rule="evenodd"></path></svg>';
  const filledStar = '<svg class="favorite-media-icon favorite-media-icon-filled" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M10.81 2.86c.38-1.15 2-1.15 2.38 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82a1.25 1.25 0 0 1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6a1.25 1.25 0 0 1 .73-2.25h6.12l1.9-5.83Z"></path></svg>';
  
  overlay.innerHTML = hollowStar + filledStar;
  
  overlay.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    overlay.blur();
    toggleFavorite(state);
  });

  state.container.appendChild(overlay);
  return overlay;
}

function ensureAccessory(target) {
  if (!(target instanceof HTMLElement)) return;

  const mediaElement = target.matches("img[src], video") ? target : target.querySelector("img[src], video");
  if (!mediaElement) return;

  const container = getMediaContainer(mediaElement);
  if (!container || container.dataset.favoriteMediaAccessory) return;

  const message = getMessageForElement(container);
  if (!message) return;

  const mediaList = collectMediaFromMessage(message);
  const entry = findMatchingEntry(mediaElement, container, message) || (mediaList.length === 1 ? mediaList[0] : null);
  if (!entry || (entry.isEmbedGif === false && entry.format === 2 && entry.isVideo === false)) return;
  // The above line is perfectly written to ensure we DO NOT skip entries that are videos, images, or embedded gifs (not gifv)

  const state: AccessoryState = { 
    container, 
    entry, 
    overlay: null, 
    pending: false, 
    queuedToggles: 0, 
    nativeObserver: entry.isEmbedGif ? hideNativeGifButton(container) : null 
  };
  state.overlay = createOverlay(state);
  container.dataset.favoriteMediaAccessory = "true";
  accessoryStates.add(state);
  updateAccessoryState(state);
}

function refreshAllAccessories() {
  for (const state of accessoryStates) {
    state.container.isConnected && state.overlay?.isConnected ? updateAccessoryState(state) : disposeAccessoryState(state);
  }
}

function detachAllAccessories() {
  accessoryStates.forEach(disposeAccessoryState);
  accessoryStates.clear();
}

export function onLoad() {
  removeCss = scoped.ui.injectCss(`
    .favorite-media-accessory {
      position: absolute;
      top: 6px;
      left: 6px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--background-base-low, rgba(0, 0, 0, 0.5));
      border-radius: 5px;
      color: var(--icon-primary, #fff);
      padding: 6px;
      box-sizing: border-box;
      cursor: pointer;
      opacity: 0;
      transform: translateY(-16px);
      transition: transform 0.2s ease, opacity 0.1s ease;
      pointer-events: none;
      z-index: 3;
    }
    .favorite-media-accessory:after {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border: 2px solid var(--yellow-300, #C9985A);
      border-radius: 50%;
      opacity: 0;
      pointer-events: none;
      z-index: 5;
      transition: all 0.15s ease-in-out;
    }
    [data-favorite-media-accessory]:hover .favorite-media-accessory {
      opacity: 0.5;
      transform: translateY(0);
      pointer-events: auto;
    }
    .favorite-media-accessory:hover,
    .favorite-media-accessory:focus {
      opacity: 1 !important;
      transition: opacity 0.12s ease-in-out;
    }
    .favorite-media-icon { 
      width: 20px;
      height: 20px;
      display: block;
      transition: color 0.12s ease;
      position: absolute;
    }
    .favorite-media-icon-filled { display: none; }
    .favorite-media-accessory[data-favorite="true"] .favorite-media-icon-hollow { display: none; }
    .favorite-media-accessory[data-favorite="true"] .favorite-media-icon-filled { display: block; }
    .favorite-media-accessory:hover .favorite-media-icon,
    .favorite-media-accessory:focus .favorite-media-icon {
      color: var(--yellow-300, #C9985A);
    }
    .favorite-media-accessory[data-favorite="true"] .favorite-media-icon-filled {
      color: var(--yellow-300, #C9985A);
    }
  `);

  stopObserve = scoped.observeDom(MEDIA_SELECTOR, el => queueMicrotask(() => ensureAccessory(el)));
  document.querySelectorAll(MEDIA_SELECTOR).forEach(ensureAccessory);
  unsubscribe = scoped.flux.subscribe("USER_SETTINGS_PROTO_UPDATE", payload => payload?.settings?.type === 2 && refreshAllAccessories());
}

export function onUnload() {
  stopObserve?.();
  unsubscribe?.();
  removeCss?.();
  detachAllAccessories();
}
