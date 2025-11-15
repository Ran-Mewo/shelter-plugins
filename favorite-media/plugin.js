(function(exports) {

"use strict";
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function() {
	return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function() {
	return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

//#endregion

//#region plugins/favorite-media/media.ts
function getFilename(url) {
	try {
		const parsed = new URL(url);
		const path = decodeURIComponent(parsed.pathname);
		const segments = path.split("/").filter(Boolean);
		return segments.length ? segments[segments.length - 1] : url;
	} catch {
		return url;
	}
}
function collectMediaFromMessage(message) {
	if (!message) return [];
	const results = [];
	const seen = new Set();
	const stripDiscordExpiration = (raw) => {
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
	const pushEntry = (entry) => {
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
			name: getFilename(url)
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
			name: attachment.filename ?? getFilename(url)
		});
	}
	return results;
}

//#endregion
//#region plugins/favorite-media/favoriting.ts
const { flux, http } = shelter;
const dispatcher = flux.dispatcher;
let protoModulePromise = null;
async function loadProtoModule() {
	protoModulePromise ??= (async () => {
		await Promise.resolve().then(function() {
			return __toESM(require_dist(), 1);
		});
		return Promise.resolve().then(function() {
			return __toESM(require_FrecencyUserSettings(), 1);
		});
	})();
	return protoModulePromise;
}
const UserSettingsProtoStore = flux.stores?.UserSettingsProtoStore;
const FAVORITE_PROTO_ENDPOINT = "/users/@me/settings-proto/2";
function getFavoritesState() {
	const storeState = UserSettingsProtoStore?.frecencyWithoutFetchingLatest?.favoriteGifs;
	return {
		gifs: { ...storeState?.gifs ?? {} },
		hideTooltip: Boolean(storeState?.hideTooltip)
	};
}
function dispatchLocalUpdate(gifs, hideTooltip) {
	dispatcher.dispatch({
		type: "USER_SETTINGS_PROTO_UPDATE",
		settings: {
			type: 2,
			proto: { favoriteGifs: {
				gifs,
				hideTooltip
			} }
		},
		partial: true,
		local: true
	});
}
async function patchFavorites(gifs, hideTooltip) {
	const { FrecencyUserSettings } = await loadProtoModule();
	const message = FrecencyUserSettings.create(UserSettingsProtoStore?.frecencyWithoutFetchingLatest ?? {});
	message.favoriteGifs = {
		gifs: Object.fromEntries(Object.entries(gifs).map(([url, entry]) => [url, { ...entry }])),
		hideTooltip
	};
	await http.patch({
		url: FAVORITE_PROTO_ENDPOINT,
		body: { settings: FrecencyUserSettings.toBase64(message) },
		oldFormErrors: false
	});
}
async function addFavoriteMedia(media) {
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
			order: Math.max(...Object.values(current.gifs).map((gif) => gif.order ?? 0)) + 1
		}
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
async function removeFavoriteMedia(url) {
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

//#endregion
//#region plugins/favorite-media/index.tsx
const { plugin, util: { getFiber, reactFiberWalker } } = shelter;
const scoped = plugin.scoped;
const accessoryStates = new Set();
let stopObserve, unsubscribe, removeCss;
const MEDIA_SELECTOR = [
	"div[class*=\"imageWrapper\"]",
	"div[class*=\"videoWrapper\"]",
	"div[class*=\"videoControls\"]",
	"div[class*=\"imageContent\"]",
	"div[class*=\"attachmentInner\"]",
	"div[class*=\"messageAttachmentMedia\"]",
	"div[class*=\"mediaAttachments\"]"
].map((s) => `${s} img[src], ${s} video`).join(", ");
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
	const messageFiber = fiber && reactFiberWalker(fiber, (c) => c?.memoizedProps?.message ?? c?.pendingProps?.message, true);
	const props = messageFiber?.memoizedProps ?? messageFiber?.pendingProps ?? {};
	return props.message ?? props.childrenProps?.message ?? null;
}
function gatherElementSources(element) {
	const sources = new Set();
	const add = (val) => {
		const n = normalizeUrl(val);
		if (n) sources.add(n);
	};
	if (element instanceof HTMLImageElement) [
		element.currentSrc,
		element.src,
		element.dataset.src
	].forEach(add);
else if (element instanceof HTMLVideoElement) {
		[
			element.currentSrc,
			element.src,
			element.poster
		].forEach(add);
		Array.from(element.querySelectorAll("source[src]")).forEach((s) => add(s.src));
	}
	Object.values(element.dataset || {}).forEach(add);
	[
		"src",
		"data-src",
		"href"
	].forEach((attr) => add(element.getAttribute(attr)));
	const anchor = element.closest("a[href]");
	if (anchor) add(anchor.href);
	return Array.from(sources);
}
function findMatchingEntry(element, container, message) {
	const mediaList = collectMediaFromMessage(message);
	if (!mediaList.length) return mediaList.length === 1 ? mediaList[0] : null;
	const sources = new Set([...gatherElementSources(element), ...gatherElementSources(container)]);
	return mediaList.find((e) => sources.has(normalizeUrl(e.url)) || sources.has(normalizeUrl(e.src))) || null;
}
function getMediaContainer(element) {
	return element.closest([
		"div[class*=\"imageWrapper\"]",
		"div[class*=\"videoControls\"]",
		"div[class*=\"videoWrapper\"]",
		"div[class*=\"imageContent\"]",
		"div[class*=\"gifCanvas\"]",
		"div[class*=\"attachmentInner\"]",
		"div[class*=\"messageAttachmentMedia\"]",
		"figure[class*=\"attachment\"]",
		"div[class*=\"galleryItem\"]"
	].join(","));
}
function hideNativeGifButton(container) {
	const findHost = () => {
		const accessory = container.querySelector("div[class*=\"imageAccessory\"]");
		const target = accessory?.querySelector("[role=\"button\"][tabindex]");
		if (!(target instanceof HTMLElement)) return null;
		const host = target.parentElement instanceof HTMLElement ? target.parentElement : target;
		return host.querySelector("svg") ? host : null;
	};
	const hideHost = () => {
		const host = findHost();
		if (host) host.style.display = "none";
	};
	const observer = new MutationObserver(hideHost);
	observer.observe(container, {
		childList: true,
		subtree: true
	});
	hideHost();
	return observer;
}
function disposeAccessoryState(state) {
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
	const hollowStar = "<svg class=\"favorite-media-icon favorite-media-icon-hollow\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" fill=\"none\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M2.07 10.94a1.25 1.25 0 0 1 .73-2.25h6.12l1.9-5.83c.37-1.15 2-1.15 2.37 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82a1.25 1.25 0 0 1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6Zm11.55-.25h5.26l-4.25 3.09 1.62 5-4.25-3.1-4.25 3.1 1.62-5-4.25-3.1h5.26l1.62-5 1.62 5Z\" clip-rule=\"evenodd\"></path></svg>";
	const filledStar = "<svg class=\"favorite-media-icon favorite-media-icon-filled\" aria-hidden=\"true\" role=\"img\" xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" fill=\"none\" viewBox=\"0 0 24 24\"><path fill=\"currentColor\" d=\"M10.81 2.86c.38-1.15 2-1.15 2.38 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82a1.25 1.25 0 0 1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6a1.25 1.25 0 0 1 .73-2.25h6.12l1.9-5.83Z\"></path></svg>";
	overlay.innerHTML = hollowStar + filledStar;
	overlay.addEventListener("click", (e) => {
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
	if (!entry || entry.isEmbedGif === false && entry.format === 2 && entry.isVideo === false) return;
	const state = {
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
	for (const state of accessoryStates) state.container.isConnected && state.overlay?.isConnected ? updateAccessoryState(state) : disposeAccessoryState(state);
}
function detachAllAccessories() {
	accessoryStates.forEach(disposeAccessoryState);
	accessoryStates.clear();
}
function onLoad() {
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
	stopObserve = scoped.observeDom(MEDIA_SELECTOR, (el) => queueMicrotask(() => ensureAccessory(el)));
	document.querySelectorAll(MEDIA_SELECTOR).forEach(ensureAccessory);
	unsubscribe = scoped.flux.subscribe("USER_SETTINGS_PROTO_UPDATE", (payload) => payload?.settings?.type === 2 && refreshAllAccessories());
}
function onUnload() {
	stopObserve?.();
	unsubscribe?.();
	removeCss?.();
	detachAllAccessories();
}

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-json-writer.js
var ReflectionJsonWriter;
var init_reflection_json_writer = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-json-writer.js"() {
	init_base64();
	init_pb_long();
	init_reflection_info();
	init_assert();
	ReflectionJsonWriter = class {
		constructor(info) {
			var _a;
			this.fields = (_a = info.fields) !== null && _a !== void 0 ? _a : [];
		}
		/**
		* Converts the message to a JSON object, based on the field descriptors.
		*/
		write(message, options) {
			const json = {}, source = message;
			for (const field of this.fields) {
				if (!field.oneof) {
					let jsonValue$1 = this.field(field, source[field.localName], options);
					if (jsonValue$1 !== undefined) json[options.useProtoFieldName ? field.name : field.jsonName] = jsonValue$1;
					continue;
				}
				const group = source[field.oneof];
				if (group.oneofKind !== field.localName) continue;
				const opt = field.kind == "scalar" || field.kind == "enum" ? Object.assign(Object.assign({}, options), { emitDefaultValues: true }) : options;
				let jsonValue = this.field(field, group[field.localName], opt);
				assert(jsonValue !== undefined);
				json[options.useProtoFieldName ? field.name : field.jsonName] = jsonValue;
			}
			return json;
		}
		field(field, value, options) {
			let jsonValue = undefined;
			if (field.kind == "map") {
				assert(typeof value == "object" && value !== null);
				const jsonObj = {};
				switch (field.V.kind) {
					case "scalar":
						for (const [entryKey, entryValue] of Object.entries(value)) {
							const val = this.scalar(field.V.T, entryValue, field.name, false, true);
							assert(val !== undefined);
							jsonObj[entryKey.toString()] = val;
						}
						break;
					case "message":
						const messageType = field.V.T();
						for (const [entryKey, entryValue] of Object.entries(value)) {
							const val = this.message(messageType, entryValue, field.name, options);
							assert(val !== undefined);
							jsonObj[entryKey.toString()] = val;
						}
						break;
					case "enum":
						const enumInfo = field.V.T();
						for (const [entryKey, entryValue] of Object.entries(value)) {
							assert(entryValue === undefined || typeof entryValue == "number");
							const val = this.enum(enumInfo, entryValue, field.name, false, true, options.enumAsInteger);
							assert(val !== undefined);
							jsonObj[entryKey.toString()] = val;
						}
						break;
				}
				if (options.emitDefaultValues || Object.keys(jsonObj).length > 0) jsonValue = jsonObj;
			} else if (field.repeat) {
				assert(Array.isArray(value));
				const jsonArr = [];
				switch (field.kind) {
					case "scalar":
						for (let i = 0; i < value.length; i++) {
							const val = this.scalar(field.T, value[i], field.name, field.opt, true);
							assert(val !== undefined);
							jsonArr.push(val);
						}
						break;
					case "enum":
						const enumInfo = field.T();
						for (let i = 0; i < value.length; i++) {
							assert(value[i] === undefined || typeof value[i] == "number");
							const val = this.enum(enumInfo, value[i], field.name, field.opt, true, options.enumAsInteger);
							assert(val !== undefined);
							jsonArr.push(val);
						}
						break;
					case "message":
						const messageType = field.T();
						for (let i = 0; i < value.length; i++) {
							const val = this.message(messageType, value[i], field.name, options);
							assert(val !== undefined);
							jsonArr.push(val);
						}
						break;
				}
				if (options.emitDefaultValues || jsonArr.length > 0 || options.emitDefaultValues) jsonValue = jsonArr;
			} else switch (field.kind) {
				case "scalar":
					jsonValue = this.scalar(field.T, value, field.name, field.opt, options.emitDefaultValues);
					break;
				case "enum":
					jsonValue = this.enum(field.T(), value, field.name, field.opt, options.emitDefaultValues, options.enumAsInteger);
					break;
				case "message":
					jsonValue = this.message(field.T(), value, field.name, options);
					break;
			}
			return jsonValue;
		}
		/**
		* Returns `null` as the default for google.protobuf.NullValue.
		*/
		enum(type, value, fieldName, optional, emitDefaultValues, enumAsInteger) {
			if (type[0] == "google.protobuf.NullValue") return !emitDefaultValues && !optional ? undefined : null;
			if (value === undefined) {
				assert(optional);
				return undefined;
			}
			if (value === 0 && !emitDefaultValues && !optional) return undefined;
			assert(typeof value == "number");
			assert(Number.isInteger(value));
			if (enumAsInteger || !type[1].hasOwnProperty(value)) return value;
			if (type[2]) return type[2] + type[1][value];
			return type[1][value];
		}
		message(type, value, fieldName, options) {
			if (value === undefined) return options.emitDefaultValues ? null : undefined;
			return type.internalJsonWrite(value, options);
		}
		scalar(type, value, fieldName, optional, emitDefaultValues) {
			if (value === undefined) {
				assert(optional);
				return undefined;
			}
			const ed = emitDefaultValues || optional;
			switch (type) {
				case ScalarType.INT32:
				case ScalarType.SFIXED32:
				case ScalarType.SINT32:
					if (value === 0) return ed ? 0 : undefined;
					assertInt32(value);
					return value;
				case ScalarType.FIXED32:
				case ScalarType.UINT32:
					if (value === 0) return ed ? 0 : undefined;
					assertUInt32(value);
					return value;
				case ScalarType.FLOAT: assertFloat32(value);
				case ScalarType.DOUBLE:
					if (value === 0) return ed ? 0 : undefined;
					assert(typeof value == "number");
					if (Number.isNaN(value)) return "NaN";
					if (value === Number.POSITIVE_INFINITY) return "Infinity";
					if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
					return value;
				case ScalarType.STRING:
					if (value === "") return ed ? "" : undefined;
					assert(typeof value == "string");
					return value;
				case ScalarType.BOOL:
					if (value === false) return ed ? false : undefined;
					assert(typeof value == "boolean");
					return value;
				case ScalarType.UINT64:
				case ScalarType.FIXED64:
					assert(typeof value == "number" || typeof value == "string" || typeof value == "bigint");
					let ulong = PbULong.from(value);
					if (ulong.isZero() && !ed) return undefined;
					return ulong.toString();
				case ScalarType.INT64:
				case ScalarType.SFIXED64:
				case ScalarType.SINT64:
					assert(typeof value == "number" || typeof value == "string" || typeof value == "bigint");
					let long = PbLong.from(value);
					if (long.isZero() && !ed) return undefined;
					return long.toString();
				case ScalarType.BYTES:
					assert(value instanceof Uint8Array);
					if (!value.byteLength) return ed ? "" : undefined;
					return base64encode(value);
			}
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/index.js
var es2015_exports = {};
__export(es2015_exports, {
	BinaryReader: () => BinaryReader,
	BinaryWriter: () => BinaryWriter,
	LongType: () => LongType,
	MESSAGE_TYPE: () => MESSAGE_TYPE,
	MessageType: () => MessageType,
	PbLong: () => PbLong,
	PbULong: () => PbULong,
	ReflectionBinaryReader: () => ReflectionBinaryReader,
	ReflectionBinaryWriter: () => ReflectionBinaryWriter,
	ReflectionJsonReader: () => ReflectionJsonReader,
	ReflectionJsonWriter: () => ReflectionJsonWriter,
	ReflectionTypeCheck: () => ReflectionTypeCheck,
	RepeatType: () => RepeatType,
	ScalarType: () => ScalarType,
	UnknownFieldHandler: () => UnknownFieldHandler,
	WireType: () => WireType,
	assert: () => assert,
	assertFloat32: () => assertFloat32,
	assertInt32: () => assertInt32,
	assertNever: () => assertNever,
	assertUInt32: () => assertUInt32,
	base64decode: () => base64decode,
	base64encode: () => base64encode,
	binaryReadOptions: () => binaryReadOptions,
	binaryWriteOptions: () => binaryWriteOptions,
	clearOneofValue: () => clearOneofValue,
	containsMessageType: () => containsMessageType,
	getOneofValue: () => getOneofValue,
	getSelectedOneofValue: () => getSelectedOneofValue,
	isEnumObject: () => isEnumObject,
	isJsonObject: () => isJsonObject,
	isOneofGroup: () => isOneofGroup,
	jsonReadOptions: () => jsonReadOptions,
	jsonWriteOptions: () => jsonWriteOptions,
	listEnumNames: () => listEnumNames,
	listEnumNumbers: () => listEnumNumbers,
	listEnumValues: () => listEnumValues,
	lowerCamelCase: () => lowerCamelCase,
	mergeBinaryOptions: () => mergeBinaryOptions,
	mergeJsonOptions: () => mergeJsonOptions,
	normalizeFieldInfo: () => normalizeFieldInfo,
	readFieldOption: () => readFieldOption,
	readFieldOptions: () => readFieldOptions,
	readMessageOption: () => readMessageOption,
	reflectionCreate: () => reflectionCreate,
	reflectionEquals: () => reflectionEquals,
	reflectionMergePartial: () => reflectionMergePartial,
	reflectionScalarDefault: () => reflectionScalarDefault,
	setOneofValue: () => setOneofValue,
	typeofJsonValue: () => typeofJsonValue,
	utf8read: () => utf8read
});
var init_es2015 = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/index.js"() {
	init_json_typings();
	init_base64();
	init_protobufjs_utf8();
	init_binary_format_contract();
	init_binary_reader();
	init_binary_writer();
	init_pb_long();
	init_json_format_contract();
	init_message_type_contract();
	init_message_type();
	init_reflection_info();
	init_reflection_type_check();
	init_reflection_create();
	init_reflection_scalar_default();
	init_reflection_merge_partial();
	init_reflection_equals();
	init_reflection_binary_reader();
	init_reflection_binary_writer();
	init_reflection_json_reader();
	init_reflection_json_writer();
	init_reflection_contains_message_type();
	init_oneof();
	init_enum_object();
	init_lower_camel_case();
	init_assert();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/User.js
var require_User = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/User.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.User_DisplayNameStyles = exports.User_SafetyState = exports.User_BannedState = exports.User_TempBannedState = exports.User_DeferredActionState = exports.User_RestrictedState = exports.User_NormalState = exports.User_UserCollectibles = exports.User_UserNameplate = exports.User_UserPrimaryGuild = exports.User_UserAvatarDecoration = exports.User = exports.User_DisplayNameEffect = exports.User_DisplayNameFont = exports.User_SafetyAnnotations = exports.User_SafetyStateReason = void 0;
	const runtime_1$12 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$11 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$11 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$11 = (init_es2015(), __toCommonJS(es2015_exports));
	const timestamp_1$4 = require_timestamp();
	const wrappers_1$4 = require_wrappers();
	const wrappers_2$3 = require_wrappers();
	const wrappers_3$3 = require_wrappers();
	const wrappers_4$1 = require_wrappers();
	/**
	* @generated from protobuf enum discord_protos.users.v1.User.SafetyStateReason
	*/
	var User_SafetyStateReason;
	(function(User_SafetyStateReason$1) {
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_REASON_UNSPECIFIED = 0;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["REASON_UNSPECIFIED"] = 0] = "REASON_UNSPECIFIED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DISABLED_SUSPICIOUS_ACTIVITY = 1;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["DISABLED_SUSPICIOUS_ACTIVITY"] = 1] = "DISABLED_SUSPICIOUS_ACTIVITY";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_SMITE_REMOVE_EMAIL_VERIFICATION = 2;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["SMITE_REMOVE_EMAIL_VERIFICATION"] = 2] = "SMITE_REMOVE_EMAIL_VERIFICATION";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_USER_REQUIRED_VERIFICATION_INTERVENTIONS_CLIENT = 3;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["USER_REQUIRED_VERIFICATION_INTERVENTIONS_CLIENT"] = 3] = "USER_REQUIRED_VERIFICATION_INTERVENTIONS_CLIENT";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_ACTIVE_ASSIGNMENT_COMPLETED = 4;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["ACTIVE_ASSIGNMENT_COMPLETED"] = 4] = "ACTIVE_ASSIGNMENT_COMPLETED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_ACTIVE_ASSIGNMENT_CREATED = 5;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["ACTIVE_ASSIGNMENT_CREATED"] = 5] = "ACTIVE_ASSIGNMENT_CREATED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DEFERRED_ASSIGNMENT_CREATED = 6;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["DEFERRED_ASSIGNMENT_CREATED"] = 6] = "DEFERRED_ASSIGNMENT_CREATED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DEFERRED_ASSIGNMENT_UPGRADED_TO_ACTIVE = 7;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["DEFERRED_ASSIGNMENT_UPGRADED_TO_ACTIVE"] = 7] = "DEFERRED_ASSIGNMENT_UPGRADED_TO_ACTIVE";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DEFERRED_ASSIGNMENT_CANCELLED = 8;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["DEFERRED_ASSIGNMENT_CANCELLED"] = 8] = "DEFERRED_ASSIGNMENT_CANCELLED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_ASSIGNMENT_STATE_REPAIRED = 9;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["ASSIGNMENT_STATE_REPAIRED"] = 9] = "ASSIGNMENT_STATE_REPAIRED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_MANUAL_PERMANENT_BAN = 10;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["MANUAL_PERMANENT_BAN"] = 10] = "MANUAL_PERMANENT_BAN";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_SAFETY_SYSTEM_UNBAN = 11;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["SAFETY_SYSTEM_UNBAN"] = 11] = "SAFETY_SYSTEM_UNBAN";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_GENERIC_AUTOMATED_SAFETY_ACTION = 12;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["GENERIC_AUTOMATED_SAFETY_ACTION"] = 12] = "GENERIC_AUTOMATED_SAFETY_ACTION";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_GENERIC_MANUAL_SAFETY_ACTION = 13;
		*/
		User_SafetyStateReason$1[User_SafetyStateReason$1["GENERIC_MANUAL_SAFETY_ACTION"] = 13] = "GENERIC_MANUAL_SAFETY_ACTION";
	})(User_SafetyStateReason || (exports.User_SafetyStateReason = User_SafetyStateReason = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.User.SafetyAnnotations
	*/
	var User_SafetyAnnotations;
	(function(User_SafetyAnnotations$1) {
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_ANNOTATION_UNSPECIFIED = 0;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["ANNOTATION_UNSPECIFIED"] = 0] = "ANNOTATION_UNSPECIFIED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SPAMMER = 1;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["SPAMMER"] = 1] = "SPAMMER";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SELF_DELETED = 2;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["SELF_DELETED"] = 2] = "SELF_DELETED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SELF_DISABLED = 3;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["SELF_DISABLED"] = 3] = "SELF_DISABLED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_UNDERAGE_DELETED = 4;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["UNDERAGE_DELETED"] = 4] = "UNDERAGE_DELETED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SAFETY_POLICY_VIOLATION = 5;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["SAFETY_POLICY_VIOLATION"] = 5] = "SAFETY_POLICY_VIOLATION";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_INACTIVITY_DELETED = 6;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["INACTIVITY_DELETED"] = 6] = "INACTIVITY_DELETED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_GENERIC_DELETED = 7;
		*/
		User_SafetyAnnotations$1[User_SafetyAnnotations$1["GENERIC_DELETED"] = 7] = "GENERIC_DELETED";
	})(User_SafetyAnnotations || (exports.User_SafetyAnnotations = User_SafetyAnnotations = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.User.DisplayNameFont
	*/
	var User_DisplayNameFont;
	(function(User_DisplayNameFont$1) {
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_UNSPECIFIED = 0;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_DEFAULT = 11;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["DEFAULT"] = 11] = "DEFAULT";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_BANGERS = 1;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["BANGERS"] = 1] = "BANGERS";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_BIO_RHYME = 2;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["BIO_RHYME"] = 2] = "BIO_RHYME";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_CHERRY_BOMB = 3;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["CHERRY_BOMB"] = 3] = "CHERRY_BOMB";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_CHICLE = 4;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["CHICLE"] = 4] = "CHICLE";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_COMPAGNON = 5;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["COMPAGNON"] = 5] = "COMPAGNON";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_MUSEO_MODERNO = 6;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["MUSEO_MODERNO"] = 6] = "MUSEO_MODERNO";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_NEO_CASTEL = 7;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["NEO_CASTEL"] = 7] = "NEO_CASTEL";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_PIXELIFY = 8;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["PIXELIFY"] = 8] = "PIXELIFY";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_RIBES = 9;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["RIBES"] = 9] = "RIBES";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_SINISTRE = 10;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["SINISTRE"] = 10] = "SINISTRE";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_ZILLA_SLAB = 12;
		*/
		User_DisplayNameFont$1[User_DisplayNameFont$1["ZILLA_SLAB"] = 12] = "ZILLA_SLAB";
	})(User_DisplayNameFont || (exports.User_DisplayNameFont = User_DisplayNameFont = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.User.DisplayNameEffect
	*/
	var User_DisplayNameEffect;
	(function(User_DisplayNameEffect$1) {
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_UNSPECIFIED = 0;
		*/
		User_DisplayNameEffect$1[User_DisplayNameEffect$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_SOLID = 1;
		*/
		User_DisplayNameEffect$1[User_DisplayNameEffect$1["SOLID"] = 1] = "SOLID";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_GRADIENT = 2;
		*/
		User_DisplayNameEffect$1[User_DisplayNameEffect$1["GRADIENT"] = 2] = "GRADIENT";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_NEON = 3;
		*/
		User_DisplayNameEffect$1[User_DisplayNameEffect$1["NEON"] = 3] = "NEON";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_TOON = 4;
		*/
		User_DisplayNameEffect$1[User_DisplayNameEffect$1["TOON"] = 4] = "TOON";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_POP = 5;
		*/
		User_DisplayNameEffect$1[User_DisplayNameEffect$1["POP"] = 5] = "POP";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_GLOW = 6;
		*/
		User_DisplayNameEffect$1[User_DisplayNameEffect$1["GLOW"] = 6] = "GLOW";
	})(User_DisplayNameEffect || (exports.User_DisplayNameEffect = User_DisplayNameEffect = {}));
	var User$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User", [
				{
					no: 1,
					name: "id",
					kind: "scalar",
					T: 4,
					L: 0
				},
				{
					no: 2,
					name: "username",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "discriminator",
					kind: "scalar",
					T: 9
				},
				{
					no: 4,
					name: "avatar",
					kind: "message",
					T: () => wrappers_4$1.StringValue
				},
				{
					no: 5,
					name: "bot",
					kind: "scalar",
					T: 8
				},
				{
					no: 6,
					name: "public_flags",
					kind: "scalar",
					T: 4,
					L: 0
				},
				{
					no: 8,
					name: "global_name",
					kind: "message",
					T: () => wrappers_4$1.StringValue
				},
				{
					no: 9,
					name: "avatar_decoration_data",
					kind: "message",
					T: () => exports.User_UserAvatarDecoration
				},
				{
					no: 10,
					name: "primary_guild",
					kind: "message",
					T: () => exports.User_UserPrimaryGuild
				},
				{
					no: 11,
					name: "collectibles",
					kind: "message",
					T: () => exports.User_UserCollectibles
				},
				{
					no: 12,
					name: "safety_state",
					kind: "message",
					T: () => exports.User_SafetyState
				},
				{
					no: 13,
					name: "display_name_styles",
					kind: "message",
					T: () => exports.User_DisplayNameStyles
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.id = 0n;
			message.username = "";
			message.discriminator = "";
			message.bot = false;
			message.publicFlags = 0n;
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.id = reader.uint64().toBigInt();
						break;
					case 2:
						message.username = reader.string();
						break;
					case 3:
						message.discriminator = reader.string();
						break;
					case 4:
						message.avatar = wrappers_4$1.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.avatar);
						break;
					case 5:
						message.bot = reader.bool();
						break;
					case 6:
						message.publicFlags = reader.uint64().toBigInt();
						break;
					case 8:
						message.globalName = wrappers_4$1.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.globalName);
						break;
					case 9:
						message.avatarDecorationData = exports.User_UserAvatarDecoration.internalBinaryRead(reader, reader.uint32(), options, message.avatarDecorationData);
						break;
					case 10:
						message.primaryGuild = exports.User_UserPrimaryGuild.internalBinaryRead(reader, reader.uint32(), options, message.primaryGuild);
						break;
					case 11:
						message.collectibles = exports.User_UserCollectibles.internalBinaryRead(reader, reader.uint32(), options, message.collectibles);
						break;
					case 12:
						message.safetyState = exports.User_SafetyState.internalBinaryRead(reader, reader.uint32(), options, message.safetyState);
						break;
					case 13:
						message.displayNameStyles = exports.User_DisplayNameStyles.internalBinaryRead(reader, reader.uint32(), options, message.displayNameStyles);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.id !== 0n) writer.tag(1, runtime_1$12.WireType.Varint).uint64(message.id);
			if (message.username !== "") writer.tag(2, runtime_1$12.WireType.LengthDelimited).string(message.username);
			if (message.discriminator !== "") writer.tag(3, runtime_1$12.WireType.LengthDelimited).string(message.discriminator);
			if (message.avatar) wrappers_4$1.StringValue.internalBinaryWrite(message.avatar, writer.tag(4, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.bot !== false) writer.tag(5, runtime_1$12.WireType.Varint).bool(message.bot);
			if (message.publicFlags !== 0n) writer.tag(6, runtime_1$12.WireType.Varint).uint64(message.publicFlags);
			if (message.globalName) wrappers_4$1.StringValue.internalBinaryWrite(message.globalName, writer.tag(8, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.avatarDecorationData) exports.User_UserAvatarDecoration.internalBinaryWrite(message.avatarDecorationData, writer.tag(9, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.primaryGuild) exports.User_UserPrimaryGuild.internalBinaryWrite(message.primaryGuild, writer.tag(10, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.collectibles) exports.User_UserCollectibles.internalBinaryWrite(message.collectibles, writer.tag(11, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.safetyState) exports.User_SafetyState.internalBinaryWrite(message.safetyState, writer.tag(12, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.displayNameStyles) exports.User_DisplayNameStyles.internalBinaryWrite(message.displayNameStyles, writer.tag(13, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User
	*/
	exports.User = new User$Type();
	var User_UserAvatarDecoration$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.UserAvatarDecoration", [
				{
					no: 1,
					name: "asset",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "sku_id",
					kind: "message",
					T: () => wrappers_3$3.UInt64Value
				},
				{
					no: 3,
					name: "expires_at",
					kind: "message",
					T: () => wrappers_2$3.UInt32Value
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.asset = "";
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.asset = reader.string();
						break;
					case 2:
						message.skuId = wrappers_3$3.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.skuId);
						break;
					case 3:
						message.expiresAt = wrappers_2$3.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.expiresAt);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.asset !== "") writer.tag(1, runtime_1$12.WireType.LengthDelimited).string(message.asset);
			if (message.skuId) wrappers_3$3.UInt64Value.internalBinaryWrite(message.skuId, writer.tag(2, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.expiresAt) wrappers_2$3.UInt32Value.internalBinaryWrite(message.expiresAt, writer.tag(3, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.UserAvatarDecoration
	*/
	exports.User_UserAvatarDecoration = new User_UserAvatarDecoration$Type();
	var User_UserPrimaryGuild$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.UserPrimaryGuild", [
				{
					no: 1,
					name: "identity_guild_id",
					kind: "message",
					T: () => wrappers_3$3.UInt64Value
				},
				{
					no: 2,
					name: "identity_enabled",
					kind: "message",
					T: () => wrappers_1$4.BoolValue
				},
				{
					no: 3,
					name: "tag",
					kind: "message",
					T: () => wrappers_4$1.StringValue
				},
				{
					no: 4,
					name: "badge",
					kind: "message",
					T: () => wrappers_4$1.StringValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.identityGuildId = wrappers_3$3.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.identityGuildId);
						break;
					case 2:
						message.identityEnabled = wrappers_1$4.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.identityEnabled);
						break;
					case 3:
						message.tag = wrappers_4$1.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.tag);
						break;
					case 4:
						message.badge = wrappers_4$1.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.badge);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.identityGuildId) wrappers_3$3.UInt64Value.internalBinaryWrite(message.identityGuildId, writer.tag(1, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.identityEnabled) wrappers_1$4.BoolValue.internalBinaryWrite(message.identityEnabled, writer.tag(2, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.tag) wrappers_4$1.StringValue.internalBinaryWrite(message.tag, writer.tag(3, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.badge) wrappers_4$1.StringValue.internalBinaryWrite(message.badge, writer.tag(4, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.UserPrimaryGuild
	*/
	exports.User_UserPrimaryGuild = new User_UserPrimaryGuild$Type();
	var User_UserNameplate$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.UserNameplate", [
				{
					no: 1,
					name: "asset",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "palette",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "sku_id",
					kind: "message",
					T: () => wrappers_3$3.UInt64Value
				},
				{
					no: 4,
					name: "expires_at",
					kind: "message",
					T: () => timestamp_1$4.Timestamp
				},
				{
					no: 5,
					name: "label",
					kind: "scalar",
					T: 9
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.asset = "";
			message.palette = "";
			message.label = "";
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.asset = reader.string();
						break;
					case 2:
						message.palette = reader.string();
						break;
					case 3:
						message.skuId = wrappers_3$3.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.skuId);
						break;
					case 4:
						message.expiresAt = timestamp_1$4.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.expiresAt);
						break;
					case 5:
						message.label = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.asset !== "") writer.tag(1, runtime_1$12.WireType.LengthDelimited).string(message.asset);
			if (message.palette !== "") writer.tag(2, runtime_1$12.WireType.LengthDelimited).string(message.palette);
			if (message.skuId) wrappers_3$3.UInt64Value.internalBinaryWrite(message.skuId, writer.tag(3, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.expiresAt) timestamp_1$4.Timestamp.internalBinaryWrite(message.expiresAt, writer.tag(4, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.label !== "") writer.tag(5, runtime_1$12.WireType.LengthDelimited).string(message.label);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.UserNameplate
	*/
	exports.User_UserNameplate = new User_UserNameplate$Type();
	var User_UserCollectibles$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.UserCollectibles", [{
				no: 1,
				name: "nameplate",
				kind: "message",
				T: () => exports.User_UserNameplate
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.nameplate = exports.User_UserNameplate.internalBinaryRead(reader, reader.uint32(), options, message.nameplate);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.nameplate) exports.User_UserNameplate.internalBinaryWrite(message.nameplate, writer.tag(1, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.UserCollectibles
	*/
	exports.User_UserCollectibles = new User_UserCollectibles$Type();
	var User_NormalState$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.NormalState", []);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.NormalState
	*/
	exports.User_NormalState = new User_NormalState$Type();
	var User_RestrictedState$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.RestrictedState", [{
				no: 1,
				name: "restricted_until",
				kind: "message",
				T: () => timestamp_1$4.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.restrictedUntil = timestamp_1$4.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.restrictedUntil);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.restrictedUntil) timestamp_1$4.Timestamp.internalBinaryWrite(message.restrictedUntil, writer.tag(1, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.RestrictedState
	*/
	exports.User_RestrictedState = new User_RestrictedState$Type();
	var User_DeferredActionState$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.DeferredActionState", [{
				no: 1,
				name: "action_deferred_until",
				kind: "message",
				T: () => timestamp_1$4.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.actionDeferredUntil = timestamp_1$4.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.actionDeferredUntil);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.actionDeferredUntil) timestamp_1$4.Timestamp.internalBinaryWrite(message.actionDeferredUntil, writer.tag(1, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.DeferredActionState
	*/
	exports.User_DeferredActionState = new User_DeferredActionState$Type();
	var User_TempBannedState$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.TempBannedState", [{
				no: 1,
				name: "banned_until",
				kind: "message",
				T: () => timestamp_1$4.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.bannedUntil = timestamp_1$4.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.bannedUntil);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.bannedUntil) timestamp_1$4.Timestamp.internalBinaryWrite(message.bannedUntil, writer.tag(1, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.TempBannedState
	*/
	exports.User_TempBannedState = new User_TempBannedState$Type();
	var User_BannedState$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.BannedState", []);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.BannedState
	*/
	exports.User_BannedState = new User_BannedState$Type();
	var User_SafetyState$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.SafetyState", [
				{
					no: 101,
					name: "normal",
					kind: "message",
					oneof: "state",
					T: () => exports.User_NormalState
				},
				{
					no: 102,
					name: "restricted",
					kind: "message",
					oneof: "state",
					T: () => exports.User_RestrictedState
				},
				{
					no: 103,
					name: "deferred_action",
					kind: "message",
					oneof: "state",
					T: () => exports.User_DeferredActionState
				},
				{
					no: 104,
					name: "temp_banned",
					kind: "message",
					oneof: "state",
					T: () => exports.User_TempBannedState
				},
				{
					no: 105,
					name: "banned",
					kind: "message",
					oneof: "state",
					T: () => exports.User_BannedState
				},
				{
					no: 1,
					name: "reason",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.User.SafetyStateReason",
						User_SafetyStateReason,
						"SAFETY_STATE_REASON_"
					]
				},
				{
					no: 2,
					name: "annotations",
					kind: "enum",
					repeat: 1,
					T: () => [
						"discord_protos.users.v1.User.SafetyAnnotations",
						User_SafetyAnnotations,
						"SAFETY_ANNOTATIONS_"
					]
				},
				{
					no: 3,
					name: "last_mutation_id",
					kind: "message",
					T: () => wrappers_3$3.UInt64Value
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.state = { oneofKind: undefined };
			message.reason = 0;
			message.annotations = [];
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 101:
						message.state = {
							oneofKind: "normal",
							normal: exports.User_NormalState.internalBinaryRead(reader, reader.uint32(), options, message.state.normal)
						};
						break;
					case 102:
						message.state = {
							oneofKind: "restricted",
							restricted: exports.User_RestrictedState.internalBinaryRead(reader, reader.uint32(), options, message.state.restricted)
						};
						break;
					case 103:
						message.state = {
							oneofKind: "deferredAction",
							deferredAction: exports.User_DeferredActionState.internalBinaryRead(reader, reader.uint32(), options, message.state.deferredAction)
						};
						break;
					case 104:
						message.state = {
							oneofKind: "tempBanned",
							tempBanned: exports.User_TempBannedState.internalBinaryRead(reader, reader.uint32(), options, message.state.tempBanned)
						};
						break;
					case 105:
						message.state = {
							oneofKind: "banned",
							banned: exports.User_BannedState.internalBinaryRead(reader, reader.uint32(), options, message.state.banned)
						};
						break;
					case 1:
						message.reason = reader.int32();
						break;
					case 2:
						if (wireType === runtime_1$12.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.annotations.push(reader.int32());
else message.annotations.push(reader.int32());
						break;
					case 3:
						message.lastMutationId = wrappers_3$3.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.lastMutationId);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.reason !== 0) writer.tag(1, runtime_1$12.WireType.Varint).int32(message.reason);
			if (message.annotations.length) {
				writer.tag(2, runtime_1$12.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.annotations.length; i++) writer.int32(message.annotations[i]);
				writer.join();
			}
			if (message.lastMutationId) wrappers_3$3.UInt64Value.internalBinaryWrite(message.lastMutationId, writer.tag(3, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "normal") exports.User_NormalState.internalBinaryWrite(message.state.normal, writer.tag(101, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "restricted") exports.User_RestrictedState.internalBinaryWrite(message.state.restricted, writer.tag(102, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "deferredAction") exports.User_DeferredActionState.internalBinaryWrite(message.state.deferredAction, writer.tag(103, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "tempBanned") exports.User_TempBannedState.internalBinaryWrite(message.state.tempBanned, writer.tag(104, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "banned") exports.User_BannedState.internalBinaryWrite(message.state.banned, writer.tag(105, runtime_1$12.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.SafetyState
	*/
	exports.User_SafetyState = new User_SafetyState$Type();
	var User_DisplayNameStyles$Type = class extends runtime_4$11.MessageType {
		constructor() {
			super("discord_protos.users.v1.User.DisplayNameStyles", [
				{
					no: 1,
					name: "font_id",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.User.DisplayNameFont",
						User_DisplayNameFont,
						"DISPLAY_NAME_FONT_"
					]
				},
				{
					no: 2,
					name: "effect_id",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.User.DisplayNameEffect",
						User_DisplayNameEffect,
						"DISPLAY_NAME_EFFECT_"
					]
				},
				{
					no: 3,
					name: "colors",
					kind: "scalar",
					repeat: 1,
					T: 13
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.fontId = 0;
			message.effectId = 0;
			message.colors = [];
			if (value !== undefined) (0, runtime_3$11.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.fontId = reader.int32();
						break;
					case 2:
						message.effectId = reader.int32();
						break;
					case 3:
						if (wireType === runtime_1$12.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.colors.push(reader.uint32());
else message.colors.push(reader.uint32());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$11.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.fontId !== 0) writer.tag(1, runtime_1$12.WireType.Varint).int32(message.fontId);
			if (message.effectId !== 0) writer.tag(2, runtime_1$12.WireType.Varint).int32(message.effectId);
			if (message.colors.length) {
				writer.tag(3, runtime_1$12.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.colors.length; i++) writer.uint32(message.colors[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$11.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.User.DisplayNameStyles
	*/
	exports.User_DisplayNameStyles = new User_DisplayNameStyles$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/MediumUser.js
var require_MediumUser = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/MediumUser.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.MediumUser = void 0;
	const runtime_1$11 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$10 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$10 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$10 = (init_es2015(), __toCommonJS(es2015_exports));
	const wrappers_1$3 = require_wrappers();
	var MediumUser$Type = class extends runtime_4$10.MessageType {
		constructor() {
			super("discord_protos.users.v1.MediumUser", [
				{
					no: 1,
					name: "id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 2,
					name: "username",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "discriminator",
					kind: "scalar",
					T: 13
				},
				{
					no: 4,
					name: "avatar_hash",
					kind: "message",
					T: () => wrappers_1$3.StringValue
				},
				{
					no: 5,
					name: "bot",
					kind: "scalar",
					T: 8
				},
				{
					no: 6,
					name: "flags",
					kind: "scalar",
					T: 4,
					L: 0
				},
				{
					no: 7,
					name: "email",
					kind: "message",
					T: () => wrappers_1$3.StringValue
				},
				{
					no: 8,
					name: "phone",
					kind: "message",
					T: () => wrappers_1$3.StringValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.id = 0n;
			message.username = "";
			message.discriminator = 0;
			message.bot = false;
			message.flags = 0n;
			if (value !== undefined) (0, runtime_3$10.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.id = reader.fixed64().toBigInt();
						break;
					case 2:
						message.username = reader.string();
						break;
					case 3:
						message.discriminator = reader.uint32();
						break;
					case 4:
						message.avatarHash = wrappers_1$3.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.avatarHash);
						break;
					case 5:
						message.bot = reader.bool();
						break;
					case 6:
						message.flags = reader.uint64().toBigInt();
						break;
					case 7:
						message.email = wrappers_1$3.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.email);
						break;
					case 8:
						message.phone = wrappers_1$3.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.phone);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$10.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.id !== 0n) writer.tag(1, runtime_1$11.WireType.Bit64).fixed64(message.id);
			if (message.username !== "") writer.tag(2, runtime_1$11.WireType.LengthDelimited).string(message.username);
			if (message.discriminator !== 0) writer.tag(3, runtime_1$11.WireType.Varint).uint32(message.discriminator);
			if (message.avatarHash) wrappers_1$3.StringValue.internalBinaryWrite(message.avatarHash, writer.tag(4, runtime_1$11.WireType.LengthDelimited).fork(), options).join();
			if (message.bot !== false) writer.tag(5, runtime_1$11.WireType.Varint).bool(message.bot);
			if (message.flags !== 0n) writer.tag(6, runtime_1$11.WireType.Varint).uint64(message.flags);
			if (message.email) wrappers_1$3.StringValue.internalBinaryWrite(message.email, writer.tag(7, runtime_1$11.WireType.LengthDelimited).fork(), options).join();
			if (message.phone) wrappers_1$3.StringValue.internalBinaryWrite(message.phone, writer.tag(8, runtime_1$11.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$10.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.MediumUser
	*/
	exports.MediumUser = new MediumUser$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/UserData.js
var require_UserData = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/UserData.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.UserData_DisplayNameStyles = exports.UserData_PremiumState = exports.UserData_SafetyState = exports.UserData_BannedState = exports.UserData_TempBannedState = exports.UserData_DeferredActionState = exports.UserData_RestrictedState = exports.UserData_NormalState = exports.UserData_UserCollectibles = exports.UserData_UserNameplate = exports.UserData_CrossPlatformRestriction = exports.UserData_UserPrimaryGuild = exports.UserData_QuestMetadata = exports.UserData_SafetyFlag = exports.UserData_FeatureLimits = exports.UserData_RateLimitData = exports.UserData_LinkedUser = exports.UserData = exports.UserData_DisplayNameEffect = exports.UserData_DisplayNameFont = exports.UserData_PremiumSubscriptionGroupRole = exports.UserData_PremiumSubscriptionType = exports.UserData_PremiumSource = exports.UserData_SafetyAnnotations = exports.UserData_SafetyStateReason = exports.UserData_UserLinkStatus = exports.UserData_UserLinkType = void 0;
	const runtime_1$10 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$9 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$9 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$9 = (init_es2015(), __toCommonJS(es2015_exports));
	const wrappers_1$2 = require_wrappers();
	const wrappers_2$2 = require_wrappers();
	const wrappers_3$2 = require_wrappers();
	const timestamp_1$3 = require_timestamp();
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.UserLinkType
	*/
	var UserData_UserLinkType;
	(function(UserData_UserLinkType$1) {
		/**
		* @generated from protobuf enum value: USER_LINK_TYPE_UNSPECIFIED = 0;
		*/
		UserData_UserLinkType$1[UserData_UserLinkType$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: USER_LINK_TYPE_PARENT = 1;
		*/
		UserData_UserLinkType$1[UserData_UserLinkType$1["PARENT"] = 1] = "PARENT";
		/**
		* @generated from protobuf enum value: USER_LINK_TYPE_CHILD = 2;
		*/
		UserData_UserLinkType$1[UserData_UserLinkType$1["CHILD"] = 2] = "CHILD";
	})(UserData_UserLinkType || (exports.UserData_UserLinkType = UserData_UserLinkType = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.UserLinkStatus
	*/
	var UserData_UserLinkStatus;
	(function(UserData_UserLinkStatus$1) {
		/**
		* @generated from protobuf enum value: USER_LINK_STATUS_UNSPECIFIED = 0;
		*/
		UserData_UserLinkStatus$1[UserData_UserLinkStatus$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: USER_LINK_STATUS_PENDING = 1;
		*/
		UserData_UserLinkStatus$1[UserData_UserLinkStatus$1["PENDING"] = 1] = "PENDING";
		/**
		* @generated from protobuf enum value: USER_LINK_STATUS_ACTIVE = 2;
		*/
		UserData_UserLinkStatus$1[UserData_UserLinkStatus$1["ACTIVE"] = 2] = "ACTIVE";
		/**
		* @generated from protobuf enum value: USER_LINK_STATUS_INACTIVE = 3;
		*/
		UserData_UserLinkStatus$1[UserData_UserLinkStatus$1["INACTIVE"] = 3] = "INACTIVE";
		/**
		* @generated from protobuf enum value: USER_LINK_STATUS_DECLINED = 4;
		*/
		UserData_UserLinkStatus$1[UserData_UserLinkStatus$1["DECLINED"] = 4] = "DECLINED";
	})(UserData_UserLinkStatus || (exports.UserData_UserLinkStatus = UserData_UserLinkStatus = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.SafetyStateReason
	*/
	var UserData_SafetyStateReason;
	(function(UserData_SafetyStateReason$1) {
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_REASON_UNSPECIFIED = 0;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["REASON_UNSPECIFIED"] = 0] = "REASON_UNSPECIFIED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DISABLED_SUSPICIOUS_ACTIVITY = 1;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["DISABLED_SUSPICIOUS_ACTIVITY"] = 1] = "DISABLED_SUSPICIOUS_ACTIVITY";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_SMITE_REMOVE_EMAIL_VERIFICATION = 2;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["SMITE_REMOVE_EMAIL_VERIFICATION"] = 2] = "SMITE_REMOVE_EMAIL_VERIFICATION";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_USER_REQUIRED_VERIFICATION_INTERVENTIONS_CLIENT = 3;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["USER_REQUIRED_VERIFICATION_INTERVENTIONS_CLIENT"] = 3] = "USER_REQUIRED_VERIFICATION_INTERVENTIONS_CLIENT";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_ACTIVE_ASSIGNMENT_COMPLETED = 4;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["ACTIVE_ASSIGNMENT_COMPLETED"] = 4] = "ACTIVE_ASSIGNMENT_COMPLETED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_ACTIVE_ASSIGNMENT_CREATED = 5;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["ACTIVE_ASSIGNMENT_CREATED"] = 5] = "ACTIVE_ASSIGNMENT_CREATED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DEFERRED_ASSIGNMENT_CREATED = 6;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["DEFERRED_ASSIGNMENT_CREATED"] = 6] = "DEFERRED_ASSIGNMENT_CREATED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DEFERRED_ASSIGNMENT_UPGRADED_TO_ACTIVE = 7;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["DEFERRED_ASSIGNMENT_UPGRADED_TO_ACTIVE"] = 7] = "DEFERRED_ASSIGNMENT_UPGRADED_TO_ACTIVE";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_DEFERRED_ASSIGNMENT_CANCELLED = 8;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["DEFERRED_ASSIGNMENT_CANCELLED"] = 8] = "DEFERRED_ASSIGNMENT_CANCELLED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_ASSIGNMENT_STATE_REPAIRED = 9;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["ASSIGNMENT_STATE_REPAIRED"] = 9] = "ASSIGNMENT_STATE_REPAIRED";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_MANUAL_PERMANENT_BAN = 10;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["MANUAL_PERMANENT_BAN"] = 10] = "MANUAL_PERMANENT_BAN";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_SAFETY_SYSTEM_UNBAN = 11;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["SAFETY_SYSTEM_UNBAN"] = 11] = "SAFETY_SYSTEM_UNBAN";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_GENERIC_AUTOMATED_SAFETY_ACTION = 12;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["GENERIC_AUTOMATED_SAFETY_ACTION"] = 12] = "GENERIC_AUTOMATED_SAFETY_ACTION";
		/**
		* @generated from protobuf enum value: SAFETY_STATE_REASON_GENERIC_MANUAL_SAFETY_ACTION = 13;
		*/
		UserData_SafetyStateReason$1[UserData_SafetyStateReason$1["GENERIC_MANUAL_SAFETY_ACTION"] = 13] = "GENERIC_MANUAL_SAFETY_ACTION";
	})(UserData_SafetyStateReason || (exports.UserData_SafetyStateReason = UserData_SafetyStateReason = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.SafetyAnnotations
	*/
	var UserData_SafetyAnnotations;
	(function(UserData_SafetyAnnotations$1) {
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_ANNOTATION_UNSPECIFIED = 0;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["ANNOTATION_UNSPECIFIED"] = 0] = "ANNOTATION_UNSPECIFIED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SPAMMER = 1;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["SPAMMER"] = 1] = "SPAMMER";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SELF_DELETED = 2;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["SELF_DELETED"] = 2] = "SELF_DELETED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SELF_DISABLED = 3;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["SELF_DISABLED"] = 3] = "SELF_DISABLED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_UNDERAGE_DELETED = 4;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["UNDERAGE_DELETED"] = 4] = "UNDERAGE_DELETED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_SAFETY_POLICY_VIOLATION = 5;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["SAFETY_POLICY_VIOLATION"] = 5] = "SAFETY_POLICY_VIOLATION";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_INACTIVITY_DELETED = 6;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["INACTIVITY_DELETED"] = 6] = "INACTIVITY_DELETED";
		/**
		* @generated from protobuf enum value: SAFETY_ANNOTATIONS_GENERIC_DELETED = 7;
		*/
		UserData_SafetyAnnotations$1[UserData_SafetyAnnotations$1["GENERIC_DELETED"] = 7] = "GENERIC_DELETED";
	})(UserData_SafetyAnnotations || (exports.UserData_SafetyAnnotations = UserData_SafetyAnnotations = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.PremiumSource
	*/
	var UserData_PremiumSource;
	(function(UserData_PremiumSource$1) {
		/**
		* @generated from protobuf enum value: PREMIUM_SOURCE_NONE_UNSPECIFIED = 0;
		*/
		UserData_PremiumSource$1[UserData_PremiumSource$1["NONE_UNSPECIFIED"] = 0] = "NONE_UNSPECIFIED";
		/**
		* @generated from protobuf enum value: PREMIUM_SOURCE_SUBSCRIPTION = 1;
		*/
		UserData_PremiumSource$1[UserData_PremiumSource$1["SUBSCRIPTION"] = 1] = "SUBSCRIPTION";
		/**
		* @generated from protobuf enum value: PREMIUM_SOURCE_FRACTIONAL_NITRO = 2;
		*/
		UserData_PremiumSource$1[UserData_PremiumSource$1["FRACTIONAL_NITRO"] = 2] = "FRACTIONAL_NITRO";
		/**
		* @generated from protobuf enum value: PREMIUM_SOURCE_REVERSE_TRIAL = 3;
		*/
		UserData_PremiumSource$1[UserData_PremiumSource$1["REVERSE_TRIAL"] = 3] = "REVERSE_TRIAL";
		/**
		* @generated from protobuf enum value: PREMIUM_SOURCE_SUBSCRIPTION_GROUP = 4;
		*/
		UserData_PremiumSource$1[UserData_PremiumSource$1["SUBSCRIPTION_GROUP"] = 4] = "SUBSCRIPTION_GROUP";
	})(UserData_PremiumSource || (exports.UserData_PremiumSource = UserData_PremiumSource = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.PremiumSubscriptionType
	*/
	var UserData_PremiumSubscriptionType;
	(function(UserData_PremiumSubscriptionType$1) {
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_TYPE_NONE_UNSPECIFIED = 0;
		*/
		UserData_PremiumSubscriptionType$1[UserData_PremiumSubscriptionType$1["NONE_UNSPECIFIED"] = 0] = "NONE_UNSPECIFIED";
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_TYPE_BOOST_ONLY = 1;
		*/
		UserData_PremiumSubscriptionType$1[UserData_PremiumSubscriptionType$1["BOOST_ONLY"] = 1] = "BOOST_ONLY";
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_TYPE_TIER_0 = 2;
		*/
		UserData_PremiumSubscriptionType$1[UserData_PremiumSubscriptionType$1["TIER_0"] = 2] = "TIER_0";
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_TYPE_TIER_1 = 3;
		*/
		UserData_PremiumSubscriptionType$1[UserData_PremiumSubscriptionType$1["TIER_1"] = 3] = "TIER_1";
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_TYPE_TIER_2 = 4;
		*/
		UserData_PremiumSubscriptionType$1[UserData_PremiumSubscriptionType$1["TIER_2"] = 4] = "TIER_2";
	})(UserData_PremiumSubscriptionType || (exports.UserData_PremiumSubscriptionType = UserData_PremiumSubscriptionType = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.PremiumSubscriptionGroupRole
	*/
	var UserData_PremiumSubscriptionGroupRole;
	(function(UserData_PremiumSubscriptionGroupRole$1) {
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_GROUP_ROLE_UNSPECIFIED = 0;
		*/
		UserData_PremiumSubscriptionGroupRole$1[UserData_PremiumSubscriptionGroupRole$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_GROUP_ROLE_PRIMARY = 1;
		*/
		UserData_PremiumSubscriptionGroupRole$1[UserData_PremiumSubscriptionGroupRole$1["PRIMARY"] = 1] = "PRIMARY";
		/**
		* @generated from protobuf enum value: PREMIUM_SUBSCRIPTION_GROUP_ROLE_MEMBER = 2;
		*/
		UserData_PremiumSubscriptionGroupRole$1[UserData_PremiumSubscriptionGroupRole$1["MEMBER"] = 2] = "MEMBER";
	})(UserData_PremiumSubscriptionGroupRole || (exports.UserData_PremiumSubscriptionGroupRole = UserData_PremiumSubscriptionGroupRole = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.DisplayNameFont
	*/
	var UserData_DisplayNameFont;
	(function(UserData_DisplayNameFont$1) {
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_UNSPECIFIED = 0;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_DEFAULT = 11;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["DEFAULT"] = 11] = "DEFAULT";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_BANGERS = 1;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["BANGERS"] = 1] = "BANGERS";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_BIO_RHYME = 2;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["BIO_RHYME"] = 2] = "BIO_RHYME";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_CHERRY_BOMB = 3;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["CHERRY_BOMB"] = 3] = "CHERRY_BOMB";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_CHICLE = 4;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["CHICLE"] = 4] = "CHICLE";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_COMPAGNON = 5;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["COMPAGNON"] = 5] = "COMPAGNON";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_MUSEO_MODERNO = 6;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["MUSEO_MODERNO"] = 6] = "MUSEO_MODERNO";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_NEO_CASTEL = 7;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["NEO_CASTEL"] = 7] = "NEO_CASTEL";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_PIXELIFY = 8;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["PIXELIFY"] = 8] = "PIXELIFY";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_RIBES = 9;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["RIBES"] = 9] = "RIBES";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_SINISTRE = 10;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["SINISTRE"] = 10] = "SINISTRE";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_FONT_ZILLA_SLAB = 12;
		*/
		UserData_DisplayNameFont$1[UserData_DisplayNameFont$1["ZILLA_SLAB"] = 12] = "ZILLA_SLAB";
	})(UserData_DisplayNameFont || (exports.UserData_DisplayNameFont = UserData_DisplayNameFont = {}));
	/**
	* @generated from protobuf enum discord_protos.users.v1.UserData.DisplayNameEffect
	*/
	var UserData_DisplayNameEffect;
	(function(UserData_DisplayNameEffect$1) {
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_UNSPECIFIED = 0;
		*/
		UserData_DisplayNameEffect$1[UserData_DisplayNameEffect$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_SOLID = 1;
		*/
		UserData_DisplayNameEffect$1[UserData_DisplayNameEffect$1["SOLID"] = 1] = "SOLID";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_GRADIENT = 2;
		*/
		UserData_DisplayNameEffect$1[UserData_DisplayNameEffect$1["GRADIENT"] = 2] = "GRADIENT";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_NEON = 3;
		*/
		UserData_DisplayNameEffect$1[UserData_DisplayNameEffect$1["NEON"] = 3] = "NEON";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_TOON = 4;
		*/
		UserData_DisplayNameEffect$1[UserData_DisplayNameEffect$1["TOON"] = 4] = "TOON";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_POP = 5;
		*/
		UserData_DisplayNameEffect$1[UserData_DisplayNameEffect$1["POP"] = 5] = "POP";
		/**
		* @generated from protobuf enum value: DISPLAY_NAME_EFFECT_GLOW = 6;
		*/
		UserData_DisplayNameEffect$1[UserData_DisplayNameEffect$1["GLOW"] = 6] = "GLOW";
	})(UserData_DisplayNameEffect || (exports.UserData_DisplayNameEffect = UserData_DisplayNameEffect = {}));
	var UserData$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData", [
				{
					no: 1,
					name: "linked_users",
					kind: "map",
					K: 6,
					V: {
						kind: "message",
						T: () => exports.UserData_LinkedUser
					}
				},
				{
					no: 2,
					name: "safety_feature_limits",
					kind: "map",
					K: 13,
					V: {
						kind: "message",
						T: () => exports.UserData_FeatureLimits
					}
				},
				{
					no: 3,
					name: "safety_flags",
					kind: "map",
					K: 13,
					V: {
						kind: "message",
						T: () => exports.UserData_SafetyFlag
					}
				},
				{
					no: 4,
					name: "quest",
					kind: "message",
					T: () => exports.UserData_QuestMetadata
				},
				{
					no: 5,
					name: "primary_guild",
					kind: "message",
					T: () => exports.UserData_UserPrimaryGuild
				},
				{
					no: 6,
					name: "cross_platform_restriction",
					kind: "message",
					T: () => exports.UserData_CrossPlatformRestriction
				},
				{
					no: 7,
					name: "collectibles",
					kind: "message",
					T: () => exports.UserData_UserCollectibles
				},
				{
					no: 8,
					name: "safety_state",
					kind: "message",
					T: () => exports.UserData_SafetyState
				},
				{
					no: 9,
					name: "premium_state",
					kind: "message",
					T: () => exports.UserData_PremiumState
				},
				{
					no: 10,
					name: "display_name_styles",
					kind: "message",
					T: () => exports.UserData_DisplayNameStyles
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.linkedUsers = {};
			message.safetyFeatureLimits = {};
			message.safetyFlags = {};
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.linkedUsers, reader, options);
						break;
					case 2:
						this.binaryReadMap2(message.safetyFeatureLimits, reader, options);
						break;
					case 3:
						this.binaryReadMap3(message.safetyFlags, reader, options);
						break;
					case 4:
						message.quest = exports.UserData_QuestMetadata.internalBinaryRead(reader, reader.uint32(), options, message.quest);
						break;
					case 5:
						message.primaryGuild = exports.UserData_UserPrimaryGuild.internalBinaryRead(reader, reader.uint32(), options, message.primaryGuild);
						break;
					case 6:
						message.crossPlatformRestriction = exports.UserData_CrossPlatformRestriction.internalBinaryRead(reader, reader.uint32(), options, message.crossPlatformRestriction);
						break;
					case 7:
						message.collectibles = exports.UserData_UserCollectibles.internalBinaryRead(reader, reader.uint32(), options, message.collectibles);
						break;
					case 8:
						message.safetyState = exports.UserData_SafetyState.internalBinaryRead(reader, reader.uint32(), options, message.safetyState);
						break;
					case 9:
						message.premiumState = exports.UserData_PremiumState.internalBinaryRead(reader, reader.uint32(), options, message.premiumState);
						break;
					case 10:
						message.displayNameStyles = exports.UserData_DisplayNameStyles.internalBinaryRead(reader, reader.uint32(), options, message.displayNameStyles);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.UserData_LinkedUser.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.users.v1.UserData.linked_users");
				}
			}
			map[key ?? "0"] = val ?? exports.UserData_LinkedUser.create();
		}
		binaryReadMap2(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.uint32();
						break;
					case 2:
						val = exports.UserData_FeatureLimits.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.users.v1.UserData.safety_feature_limits");
				}
			}
			map[key ?? 0] = val ?? exports.UserData_FeatureLimits.create();
		}
		binaryReadMap3(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.uint32();
						break;
					case 2:
						val = exports.UserData_SafetyFlag.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.users.v1.UserData.safety_flags");
				}
			}
			map[key ?? 0] = val ?? exports.UserData_SafetyFlag.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.linkedUsers)) {
				writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork().tag(1, runtime_1$10.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$10.WireType.LengthDelimited).fork();
				exports.UserData_LinkedUser.internalBinaryWrite(message.linkedUsers[k], writer, options);
				writer.join().join();
			}
			for (let k of globalThis.Object.keys(message.safetyFeatureLimits)) {
				writer.tag(2, runtime_1$10.WireType.LengthDelimited).fork().tag(1, runtime_1$10.WireType.Varint).uint32(parseInt(k));
				writer.tag(2, runtime_1$10.WireType.LengthDelimited).fork();
				exports.UserData_FeatureLimits.internalBinaryWrite(message.safetyFeatureLimits[k], writer, options);
				writer.join().join();
			}
			for (let k of globalThis.Object.keys(message.safetyFlags)) {
				writer.tag(3, runtime_1$10.WireType.LengthDelimited).fork().tag(1, runtime_1$10.WireType.Varint).uint32(parseInt(k));
				writer.tag(2, runtime_1$10.WireType.LengthDelimited).fork();
				exports.UserData_SafetyFlag.internalBinaryWrite(message.safetyFlags[k], writer, options);
				writer.join().join();
			}
			if (message.quest) exports.UserData_QuestMetadata.internalBinaryWrite(message.quest, writer.tag(4, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.primaryGuild) exports.UserData_UserPrimaryGuild.internalBinaryWrite(message.primaryGuild, writer.tag(5, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.crossPlatformRestriction) exports.UserData_CrossPlatformRestriction.internalBinaryWrite(message.crossPlatformRestriction, writer.tag(6, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.collectibles) exports.UserData_UserCollectibles.internalBinaryWrite(message.collectibles, writer.tag(7, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.safetyState) exports.UserData_SafetyState.internalBinaryWrite(message.safetyState, writer.tag(8, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.premiumState) exports.UserData_PremiumState.internalBinaryWrite(message.premiumState, writer.tag(9, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.displayNameStyles) exports.UserData_DisplayNameStyles.internalBinaryWrite(message.displayNameStyles, writer.tag(10, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData
	*/
	exports.UserData = new UserData$Type();
	var UserData_LinkedUser$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.LinkedUser", [
				{
					no: 1,
					name: "user_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 2,
					name: "link_type",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.UserLinkType",
						UserData_UserLinkType,
						"USER_LINK_TYPE_"
					]
				},
				{
					no: 3,
					name: "link_status",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.UserLinkStatus",
						UserData_UserLinkStatus,
						"USER_LINK_STATUS_"
					]
				},
				{
					no: 4,
					name: "requestor_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 5,
					name: "created_at",
					kind: "message",
					T: () => timestamp_1$3.Timestamp
				},
				{
					no: 6,
					name: "updated_at",
					kind: "message",
					T: () => timestamp_1$3.Timestamp
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.userId = 0n;
			message.linkType = 0;
			message.linkStatus = 0;
			message.requestorId = 0n;
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.userId = reader.fixed64().toBigInt();
						break;
					case 2:
						message.linkType = reader.int32();
						break;
					case 3:
						message.linkStatus = reader.int32();
						break;
					case 4:
						message.requestorId = reader.fixed64().toBigInt();
						break;
					case 5:
						message.createdAt = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.createdAt);
						break;
					case 6:
						message.updatedAt = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.updatedAt);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.userId !== 0n) writer.tag(1, runtime_1$10.WireType.Bit64).fixed64(message.userId);
			if (message.linkType !== 0) writer.tag(2, runtime_1$10.WireType.Varint).int32(message.linkType);
			if (message.linkStatus !== 0) writer.tag(3, runtime_1$10.WireType.Varint).int32(message.linkStatus);
			if (message.requestorId !== 0n) writer.tag(4, runtime_1$10.WireType.Bit64).fixed64(message.requestorId);
			if (message.createdAt) timestamp_1$3.Timestamp.internalBinaryWrite(message.createdAt, writer.tag(5, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.updatedAt) timestamp_1$3.Timestamp.internalBinaryWrite(message.updatedAt, writer.tag(6, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.LinkedUser
	*/
	exports.UserData_LinkedUser = new UserData_LinkedUser$Type();
	var UserData_RateLimitData$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.RateLimitData", [{
				no: 1,
				name: "limit_expiry",
				kind: "message",
				T: () => timestamp_1$3.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.limitExpiry = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.limitExpiry);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.limitExpiry) timestamp_1$3.Timestamp.internalBinaryWrite(message.limitExpiry, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.RateLimitData
	*/
	exports.UserData_RateLimitData = new UserData_RateLimitData$Type();
	var UserData_FeatureLimits$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.FeatureLimits", [{
				no: 1,
				name: "map",
				kind: "map",
				K: 13,
				V: {
					kind: "message",
					T: () => exports.UserData_RateLimitData
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.map = {};
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.map, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.uint32();
						break;
					case 2:
						val = exports.UserData_RateLimitData.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.users.v1.UserData.FeatureLimits.map");
				}
			}
			map[key ?? 0] = val ?? exports.UserData_RateLimitData.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.map)) {
				writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork().tag(1, runtime_1$10.WireType.Varint).uint32(parseInt(k));
				writer.tag(2, runtime_1$10.WireType.LengthDelimited).fork();
				exports.UserData_RateLimitData.internalBinaryWrite(message.map[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.FeatureLimits
	*/
	exports.UserData_FeatureLimits = new UserData_FeatureLimits$Type();
	var UserData_SafetyFlag$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.SafetyFlag", [{
				no: 1,
				name: "flag_expiry",
				kind: "message",
				T: () => timestamp_1$3.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.flagExpiry = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.flagExpiry);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.flagExpiry) timestamp_1$3.Timestamp.internalBinaryWrite(message.flagExpiry, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.SafetyFlag
	*/
	exports.UserData_SafetyFlag = new UserData_SafetyFlag$Type();
	var UserData_QuestMetadata$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.QuestMetadata", [{
				no: 1,
				name: "quests_completed",
				kind: "scalar",
				T: 13
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.questsCompleted = 0;
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.questsCompleted = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.questsCompleted !== 0) writer.tag(1, runtime_1$10.WireType.Varint).uint32(message.questsCompleted);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.QuestMetadata
	*/
	exports.UserData_QuestMetadata = new UserData_QuestMetadata$Type();
	var UserData_UserPrimaryGuild$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.UserPrimaryGuild", [
				{
					no: 1,
					name: "identity_guild_id",
					kind: "message",
					T: () => wrappers_3$2.UInt64Value
				},
				{
					no: 2,
					name: "identity_enabled",
					kind: "message",
					T: () => wrappers_2$2.BoolValue
				},
				{
					no: 3,
					name: "tag",
					kind: "message",
					T: () => wrappers_1$2.StringValue
				},
				{
					no: 4,
					name: "badge",
					kind: "message",
					T: () => wrappers_1$2.StringValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.identityGuildId = wrappers_3$2.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.identityGuildId);
						break;
					case 2:
						message.identityEnabled = wrappers_2$2.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.identityEnabled);
						break;
					case 3:
						message.tag = wrappers_1$2.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.tag);
						break;
					case 4:
						message.badge = wrappers_1$2.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.badge);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.identityGuildId) wrappers_3$2.UInt64Value.internalBinaryWrite(message.identityGuildId, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.identityEnabled) wrappers_2$2.BoolValue.internalBinaryWrite(message.identityEnabled, writer.tag(2, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.tag) wrappers_1$2.StringValue.internalBinaryWrite(message.tag, writer.tag(3, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.badge) wrappers_1$2.StringValue.internalBinaryWrite(message.badge, writer.tag(4, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.UserPrimaryGuild
	*/
	exports.UserData_UserPrimaryGuild = new UserData_UserPrimaryGuild$Type();
	var UserData_CrossPlatformRestriction$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.CrossPlatformRestriction", [{
				no: 1,
				name: "restriction_expiry",
				kind: "message",
				T: () => timestamp_1$3.Timestamp
			}, {
				no: 2,
				name: "application_id",
				kind: "scalar",
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.applicationId = 0n;
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.restrictionExpiry = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.restrictionExpiry);
						break;
					case 2:
						message.applicationId = reader.fixed64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.restrictionExpiry) timestamp_1$3.Timestamp.internalBinaryWrite(message.restrictionExpiry, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.applicationId !== 0n) writer.tag(2, runtime_1$10.WireType.Bit64).fixed64(message.applicationId);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.CrossPlatformRestriction
	*/
	exports.UserData_CrossPlatformRestriction = new UserData_CrossPlatformRestriction$Type();
	var UserData_UserNameplate$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.UserNameplate", [
				{
					no: 1,
					name: "asset",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "palette",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "sku_id",
					kind: "message",
					T: () => wrappers_3$2.UInt64Value
				},
				{
					no: 4,
					name: "expires_at",
					kind: "message",
					T: () => timestamp_1$3.Timestamp
				},
				{
					no: 5,
					name: "label",
					kind: "scalar",
					T: 9
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.asset = "";
			message.palette = "";
			message.label = "";
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.asset = reader.string();
						break;
					case 2:
						message.palette = reader.string();
						break;
					case 3:
						message.skuId = wrappers_3$2.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.skuId);
						break;
					case 4:
						message.expiresAt = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.expiresAt);
						break;
					case 5:
						message.label = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.asset !== "") writer.tag(1, runtime_1$10.WireType.LengthDelimited).string(message.asset);
			if (message.palette !== "") writer.tag(2, runtime_1$10.WireType.LengthDelimited).string(message.palette);
			if (message.skuId) wrappers_3$2.UInt64Value.internalBinaryWrite(message.skuId, writer.tag(3, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.expiresAt) timestamp_1$3.Timestamp.internalBinaryWrite(message.expiresAt, writer.tag(4, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.label !== "") writer.tag(5, runtime_1$10.WireType.LengthDelimited).string(message.label);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.UserNameplate
	*/
	exports.UserData_UserNameplate = new UserData_UserNameplate$Type();
	var UserData_UserCollectibles$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.UserCollectibles", [{
				no: 1,
				name: "nameplate",
				kind: "message",
				T: () => exports.UserData_UserNameplate
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.nameplate = exports.UserData_UserNameplate.internalBinaryRead(reader, reader.uint32(), options, message.nameplate);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.nameplate) exports.UserData_UserNameplate.internalBinaryWrite(message.nameplate, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.UserCollectibles
	*/
	exports.UserData_UserCollectibles = new UserData_UserCollectibles$Type();
	var UserData_NormalState$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.NormalState", []);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.NormalState
	*/
	exports.UserData_NormalState = new UserData_NormalState$Type();
	var UserData_RestrictedState$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.RestrictedState", [{
				no: 1,
				name: "restricted_until",
				kind: "message",
				T: () => timestamp_1$3.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.restrictedUntil = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.restrictedUntil);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.restrictedUntil) timestamp_1$3.Timestamp.internalBinaryWrite(message.restrictedUntil, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.RestrictedState
	*/
	exports.UserData_RestrictedState = new UserData_RestrictedState$Type();
	var UserData_DeferredActionState$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.DeferredActionState", [{
				no: 1,
				name: "action_deferred_until",
				kind: "message",
				T: () => timestamp_1$3.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.actionDeferredUntil = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.actionDeferredUntil);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.actionDeferredUntil) timestamp_1$3.Timestamp.internalBinaryWrite(message.actionDeferredUntil, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.DeferredActionState
	*/
	exports.UserData_DeferredActionState = new UserData_DeferredActionState$Type();
	var UserData_TempBannedState$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.TempBannedState", [{
				no: 1,
				name: "banned_until",
				kind: "message",
				T: () => timestamp_1$3.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.bannedUntil = timestamp_1$3.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.bannedUntil);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.bannedUntil) timestamp_1$3.Timestamp.internalBinaryWrite(message.bannedUntil, writer.tag(1, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.TempBannedState
	*/
	exports.UserData_TempBannedState = new UserData_TempBannedState$Type();
	var UserData_BannedState$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.BannedState", []);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.BannedState
	*/
	exports.UserData_BannedState = new UserData_BannedState$Type();
	var UserData_SafetyState$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.SafetyState", [
				{
					no: 101,
					name: "normal",
					kind: "message",
					oneof: "state",
					T: () => exports.UserData_NormalState
				},
				{
					no: 102,
					name: "restricted",
					kind: "message",
					oneof: "state",
					T: () => exports.UserData_RestrictedState
				},
				{
					no: 103,
					name: "deferred_action",
					kind: "message",
					oneof: "state",
					T: () => exports.UserData_DeferredActionState
				},
				{
					no: 104,
					name: "temp_banned",
					kind: "message",
					oneof: "state",
					T: () => exports.UserData_TempBannedState
				},
				{
					no: 105,
					name: "banned",
					kind: "message",
					oneof: "state",
					T: () => exports.UserData_BannedState
				},
				{
					no: 1,
					name: "reason",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.SafetyStateReason",
						UserData_SafetyStateReason,
						"SAFETY_STATE_REASON_"
					]
				},
				{
					no: 2,
					name: "annotations",
					kind: "enum",
					repeat: 1,
					T: () => [
						"discord_protos.users.v1.UserData.SafetyAnnotations",
						UserData_SafetyAnnotations,
						"SAFETY_ANNOTATIONS_"
					]
				},
				{
					no: 3,
					name: "last_mutation_id",
					kind: "message",
					T: () => wrappers_3$2.UInt64Value
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.state = { oneofKind: undefined };
			message.reason = 0;
			message.annotations = [];
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 101:
						message.state = {
							oneofKind: "normal",
							normal: exports.UserData_NormalState.internalBinaryRead(reader, reader.uint32(), options, message.state.normal)
						};
						break;
					case 102:
						message.state = {
							oneofKind: "restricted",
							restricted: exports.UserData_RestrictedState.internalBinaryRead(reader, reader.uint32(), options, message.state.restricted)
						};
						break;
					case 103:
						message.state = {
							oneofKind: "deferredAction",
							deferredAction: exports.UserData_DeferredActionState.internalBinaryRead(reader, reader.uint32(), options, message.state.deferredAction)
						};
						break;
					case 104:
						message.state = {
							oneofKind: "tempBanned",
							tempBanned: exports.UserData_TempBannedState.internalBinaryRead(reader, reader.uint32(), options, message.state.tempBanned)
						};
						break;
					case 105:
						message.state = {
							oneofKind: "banned",
							banned: exports.UserData_BannedState.internalBinaryRead(reader, reader.uint32(), options, message.state.banned)
						};
						break;
					case 1:
						message.reason = reader.int32();
						break;
					case 2:
						if (wireType === runtime_1$10.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.annotations.push(reader.int32());
else message.annotations.push(reader.int32());
						break;
					case 3:
						message.lastMutationId = wrappers_3$2.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.lastMutationId);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.reason !== 0) writer.tag(1, runtime_1$10.WireType.Varint).int32(message.reason);
			if (message.annotations.length) {
				writer.tag(2, runtime_1$10.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.annotations.length; i++) writer.int32(message.annotations[i]);
				writer.join();
			}
			if (message.lastMutationId) wrappers_3$2.UInt64Value.internalBinaryWrite(message.lastMutationId, writer.tag(3, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "normal") exports.UserData_NormalState.internalBinaryWrite(message.state.normal, writer.tag(101, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "restricted") exports.UserData_RestrictedState.internalBinaryWrite(message.state.restricted, writer.tag(102, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "deferredAction") exports.UserData_DeferredActionState.internalBinaryWrite(message.state.deferredAction, writer.tag(103, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "tempBanned") exports.UserData_TempBannedState.internalBinaryWrite(message.state.tempBanned, writer.tag(104, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			if (message.state.oneofKind === "banned") exports.UserData_BannedState.internalBinaryWrite(message.state.banned, writer.tag(105, runtime_1$10.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.SafetyState
	*/
	exports.UserData_SafetyState = new UserData_SafetyState$Type();
	var UserData_PremiumState$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.PremiumState", [
				{
					no: 1,
					name: "premium_source",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.PremiumSource",
						UserData_PremiumSource,
						"PREMIUM_SOURCE_"
					]
				},
				{
					no: 2,
					name: "premium_subscription_type",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.PremiumSubscriptionType",
						UserData_PremiumSubscriptionType,
						"PREMIUM_SUBSCRIPTION_TYPE_"
					]
				},
				{
					no: 3,
					name: "premium_subscription_group_role",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.PremiumSubscriptionGroupRole",
						UserData_PremiumSubscriptionGroupRole,
						"PREMIUM_SUBSCRIPTION_GROUP_ROLE_"
					]
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.premiumSource = 0;
			message.premiumSubscriptionType = 0;
			message.premiumSubscriptionGroupRole = 0;
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.premiumSource = reader.int32();
						break;
					case 2:
						message.premiumSubscriptionType = reader.int32();
						break;
					case 3:
						message.premiumSubscriptionGroupRole = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.premiumSource !== 0) writer.tag(1, runtime_1$10.WireType.Varint).int32(message.premiumSource);
			if (message.premiumSubscriptionType !== 0) writer.tag(2, runtime_1$10.WireType.Varint).int32(message.premiumSubscriptionType);
			if (message.premiumSubscriptionGroupRole !== 0) writer.tag(3, runtime_1$10.WireType.Varint).int32(message.premiumSubscriptionGroupRole);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.PremiumState
	*/
	exports.UserData_PremiumState = new UserData_PremiumState$Type();
	var UserData_DisplayNameStyles$Type = class extends runtime_4$9.MessageType {
		constructor() {
			super("discord_protos.users.v1.UserData.DisplayNameStyles", [
				{
					no: 1,
					name: "font_id",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.DisplayNameFont",
						UserData_DisplayNameFont,
						"DISPLAY_NAME_FONT_"
					]
				},
				{
					no: 2,
					name: "effect_id",
					kind: "enum",
					T: () => [
						"discord_protos.users.v1.UserData.DisplayNameEffect",
						UserData_DisplayNameEffect,
						"DISPLAY_NAME_EFFECT_"
					]
				},
				{
					no: 3,
					name: "colors",
					kind: "scalar",
					repeat: 1,
					T: 13
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.fontId = 0;
			message.effectId = 0;
			message.colors = [];
			if (value !== undefined) (0, runtime_3$9.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.fontId = reader.int32();
						break;
					case 2:
						message.effectId = reader.int32();
						break;
					case 3:
						if (wireType === runtime_1$10.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.colors.push(reader.uint32());
else message.colors.push(reader.uint32());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.fontId !== 0) writer.tag(1, runtime_1$10.WireType.Varint).int32(message.fontId);
			if (message.effectId !== 0) writer.tag(2, runtime_1$10.WireType.Varint).int32(message.effectId);
			if (message.colors.length) {
				writer.tag(3, runtime_1$10.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.colors.length; i++) writer.uint32(message.colors[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.UserData.DisplayNameStyles
	*/
	exports.UserData_DisplayNameStyles = new UserData_DisplayNameStyles$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/GuildShardingConfig.js
var require_GuildShardingConfig = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/users/v1/GuildShardingConfig.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.GuildShardingConfig = void 0;
	const runtime_1$9 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$8 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$8 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$8 = (init_es2015(), __toCommonJS(es2015_exports));
	var GuildShardingConfig$Type = class extends runtime_4$8.MessageType {
		constructor() {
			super("discord_protos.users.v1.GuildShardingConfig", [{
				no: 1,
				name: "shards",
				kind: "scalar",
				repeat: 1,
				T: 5
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.shards = [];
			if (value !== undefined) (0, runtime_3$8.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (wireType === runtime_2$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.shards.push(reader.int32());
else message.shards.push(reader.int32());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$9.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.shards.length) {
				writer.tag(1, runtime_2$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.shards.length; i++) writer.int32(message.shards[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$9.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.users.v1.GuildShardingConfig
	*/
	exports.GuildShardingConfig = new GuildShardingConfig$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_users/v1/PreloadedUserSettings.js
var require_PreloadedUserSettings = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_users/v1/PreloadedUserSettings.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.PreloadedUserSettings_ClientThemeSettings = exports.PreloadedUserSettings_CustomUserThemeSettings = exports.PreloadedUserSettings_LocalizationSettings = exports.PreloadedUserSettings_StatusSettings = exports.PreloadedUserSettings_CustomStatus = exports.PreloadedUserSettings_GameLibrarySettings = exports.PreloadedUserSettings_DebugSettings = exports.PreloadedUserSettings_PrivacySettings = exports.PreloadedUserSettings_NotificationSettings = exports.PreloadedUserSettings_TextAndImagesSettings = exports.PreloadedUserSettings_SelfHarmContentSettings = exports.PreloadedUserSettings_DefaultReactionEmoji = exports.PreloadedUserSettings_GoreContentSettings = exports.PreloadedUserSettings_KeywordFilterSettings = exports.PreloadedUserSettings_ExplicitContentSettings = exports.PreloadedUserSettings_VoiceAndVideoSettings = exports.PreloadedUserSettings_SoundboardSettings = exports.PreloadedUserSettings_VideoFilterAsset = exports.PreloadedUserSettings_VideoFilterBackgroundBlur = exports.PreloadedUserSettings_UserContentSettings = exports.PreloadedUserSettings_RecurringDismissibleContentState = exports.PreloadedUserSettings_AllGuildSettings = exports.PreloadedUserSettings_GuildSettings = exports.PreloadedUserSettings_GuildDismissibleContentState = exports.PreloadedUserSettings_ChannelListSettings = exports.PreloadedUserSettings_CustomCallSound = exports.PreloadedUserSettings_ChannelSettings = exports.PreloadedUserSettings_CustomNotificationSoundConfig = exports.PreloadedUserSettings_ChannelIconEmoji = exports.PreloadedUserSettings_InboxSettings = exports.PreloadedUserSettings_Versions = exports.PreloadedUserSettings = exports.PreloadedUserSettings_SafetySettingsPresetType = exports.PreloadedUserSettings_ForLaterTab = exports.PreloadedUserSettings_FavoriteChannelType = exports.PreloadedUserSettings_SwipeRightToLeftMode = exports.PreloadedUserSettings_UIDensity = exports.PreloadedUserSettings_LaunchPadMode = exports.PreloadedUserSettings_TimestampHourCycle = exports.PreloadedUserSettings_Theme = exports.PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2 = exports.PreloadedUserSettings_SlayerSDKReceiveInGameDMs = exports.PreloadedUserSettings_GuildsLeaderboardOptOutDefault = exports.PreloadedUserSettings_GuildActivityStatusRestrictionDefault = exports.PreloadedUserSettings_CustomStatusPushNotificationType = exports.PreloadedUserSettings_GameActivityNotificationType = exports.PreloadedUserSettings_ReactionNotificationType = exports.PreloadedUserSettings_ExplicitContentRedaction = exports.PreloadedUserSettings_DmSpamFilterV2 = exports.PreloadedUserSettings_InboxTab = void 0;
	exports.PreloadedUserSettings_InAppFeedbackSettings = exports.PreloadedUserSettings_InAppFeedbackState = exports.PreloadedUserSettings_AdsSettings = exports.PreloadedUserSettings_AllApplicationSettings = exports.PreloadedUserSettings_ApplicationSettings = exports.PreloadedUserSettings_ApplicationSharingSettings = exports.PreloadedUserSettings_ApplicationDMSettings = exports.PreloadedUserSettings_ICYMISettings = exports.PreloadedUserSettings_SafetySettings = exports.PreloadedUserSettings_ForLaterSettings = exports.PreloadedUserSettings_ClipsSettings = exports.PreloadedUserSettings_BroadcastSettings = exports.PreloadedUserSettings_CommunitiesSettings = exports.PreloadedUserSettings_AudioSettings = exports.PreloadedUserSettings_AudioContextSetting = exports.PreloadedUserSettings_Favorites = exports.PreloadedUserSettings_FavoriteChannel = exports.PreloadedUserSettings_GuildFolders = exports.PreloadedUserSettings_GuildFolder = exports.PreloadedUserSettings_AppearanceSettings = void 0;
	const runtime_1$8 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$7 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$7 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$7 = (init_es2015(), __toCommonJS(es2015_exports));
	const wrappers_1$1 = require_wrappers();
	const wrappers_2$1 = require_wrappers();
	const wrappers_3$1 = require_wrappers();
	const wrappers_4 = require_wrappers();
	const wrappers_5 = require_wrappers();
	const timestamp_1$2 = require_timestamp();
	const wrappers_6 = require_wrappers();
	const wrappers_7 = require_wrappers();
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.InboxTab
	*/
	var PreloadedUserSettings_InboxTab;
	(function(PreloadedUserSettings_InboxTab$1) {
		/**
		* @generated from protobuf enum value: INBOX_TAB_UNSPECIFIED = 0;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: INBOX_TAB_MENTIONS = 1;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["MENTIONS"] = 1] = "MENTIONS";
		/**
		* @generated from protobuf enum value: INBOX_TAB_UNREADS = 2;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["UNREADS"] = 2] = "UNREADS";
		/**
		* @generated from protobuf enum value: INBOX_TAB_TODOS = 3;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["TODOS"] = 3] = "TODOS";
		/**
		* @generated from protobuf enum value: INBOX_TAB_FOR_YOU = 4;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["FOR_YOU"] = 4] = "FOR_YOU";
		/**
		* @generated from protobuf enum value: INBOX_TAB_GAME_INVITES = 5;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["GAME_INVITES"] = 5] = "GAME_INVITES";
		/**
		* @generated from protobuf enum value: INBOX_TAB_BOOKMARKS = 6;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["BOOKMARKS"] = 6] = "BOOKMARKS";
		/**
		* @generated from protobuf enum value: INBOX_TAB_SCHEDULED = 7;
		*/
		PreloadedUserSettings_InboxTab$1[PreloadedUserSettings_InboxTab$1["SCHEDULED"] = 7] = "SCHEDULED";
	})(PreloadedUserSettings_InboxTab || (exports.PreloadedUserSettings_InboxTab = PreloadedUserSettings_InboxTab = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.DmSpamFilterV2
	*/
	var PreloadedUserSettings_DmSpamFilterV2;
	(function(PreloadedUserSettings_DmSpamFilterV2$1) {
		/**
		* @generated from protobuf enum value: DM_SPAM_FILTER_V2_DEFAULT_UNSET = 0;
		*/
		PreloadedUserSettings_DmSpamFilterV2$1[PreloadedUserSettings_DmSpamFilterV2$1["DEFAULT_UNSET"] = 0] = "DEFAULT_UNSET";
		/**
		* @generated from protobuf enum value: DM_SPAM_FILTER_V2_DISABLED = 1;
		*/
		PreloadedUserSettings_DmSpamFilterV2$1[PreloadedUserSettings_DmSpamFilterV2$1["DISABLED"] = 1] = "DISABLED";
		/**
		* @generated from protobuf enum value: DM_SPAM_FILTER_V2_NON_FRIENDS = 2;
		*/
		PreloadedUserSettings_DmSpamFilterV2$1[PreloadedUserSettings_DmSpamFilterV2$1["NON_FRIENDS"] = 2] = "NON_FRIENDS";
		/**
		* @generated from protobuf enum value: DM_SPAM_FILTER_V2_FRIENDS_AND_NON_FRIENDS = 3;
		*/
		PreloadedUserSettings_DmSpamFilterV2$1[PreloadedUserSettings_DmSpamFilterV2$1["FRIENDS_AND_NON_FRIENDS"] = 3] = "FRIENDS_AND_NON_FRIENDS";
	})(PreloadedUserSettings_DmSpamFilterV2 || (exports.PreloadedUserSettings_DmSpamFilterV2 = PreloadedUserSettings_DmSpamFilterV2 = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction
	*/
	var PreloadedUserSettings_ExplicitContentRedaction;
	(function(PreloadedUserSettings_ExplicitContentRedaction$1) {
		/**
		* @generated from protobuf enum value: EXPLICIT_CONTENT_REDACTION_UNSET_EXPLICIT_CONTENT_REDACTION = 0;
		*/
		PreloadedUserSettings_ExplicitContentRedaction$1[PreloadedUserSettings_ExplicitContentRedaction$1["UNSET_EXPLICIT_CONTENT_REDACTION"] = 0] = "UNSET_EXPLICIT_CONTENT_REDACTION";
		/**
		* @generated from protobuf enum value: EXPLICIT_CONTENT_REDACTION_SHOW = 1;
		*/
		PreloadedUserSettings_ExplicitContentRedaction$1[PreloadedUserSettings_ExplicitContentRedaction$1["SHOW"] = 1] = "SHOW";
		/**
		* @generated from protobuf enum value: EXPLICIT_CONTENT_REDACTION_BLUR = 2;
		*/
		PreloadedUserSettings_ExplicitContentRedaction$1[PreloadedUserSettings_ExplicitContentRedaction$1["BLUR"] = 2] = "BLUR";
		/**
		* @generated from protobuf enum value: EXPLICIT_CONTENT_REDACTION_BLOCK = 3;
		*/
		PreloadedUserSettings_ExplicitContentRedaction$1[PreloadedUserSettings_ExplicitContentRedaction$1["BLOCK"] = 3] = "BLOCK";
	})(PreloadedUserSettings_ExplicitContentRedaction || (exports.PreloadedUserSettings_ExplicitContentRedaction = PreloadedUserSettings_ExplicitContentRedaction = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.ReactionNotificationType
	*/
	var PreloadedUserSettings_ReactionNotificationType;
	(function(PreloadedUserSettings_ReactionNotificationType$1) {
		/**
		* @generated from protobuf enum value: REACTION_NOTIFICATION_TYPE_NOTIFICATIONS_ENABLED = 0;
		*/
		PreloadedUserSettings_ReactionNotificationType$1[PreloadedUserSettings_ReactionNotificationType$1["NOTIFICATIONS_ENABLED"] = 0] = "NOTIFICATIONS_ENABLED";
		/**
		* @generated from protobuf enum value: REACTION_NOTIFICATION_TYPE_ONLY_DMS = 1;
		*/
		PreloadedUserSettings_ReactionNotificationType$1[PreloadedUserSettings_ReactionNotificationType$1["ONLY_DMS"] = 1] = "ONLY_DMS";
		/**
		* @generated from protobuf enum value: REACTION_NOTIFICATION_TYPE_NOTIFICATIONS_DISABLED = 2;
		*/
		PreloadedUserSettings_ReactionNotificationType$1[PreloadedUserSettings_ReactionNotificationType$1["NOTIFICATIONS_DISABLED"] = 2] = "NOTIFICATIONS_DISABLED";
	})(PreloadedUserSettings_ReactionNotificationType || (exports.PreloadedUserSettings_ReactionNotificationType = PreloadedUserSettings_ReactionNotificationType = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.GameActivityNotificationType
	*/
	var PreloadedUserSettings_GameActivityNotificationType;
	(function(PreloadedUserSettings_GameActivityNotificationType$1) {
		/**
		* @generated from protobuf enum value: GAME_ACTIVITY_NOTIFICATION_TYPE_ACTIVITY_NOTIFICATIONS_UNSET = 0;
		*/
		PreloadedUserSettings_GameActivityNotificationType$1[PreloadedUserSettings_GameActivityNotificationType$1["ACTIVITY_NOTIFICATIONS_UNSET"] = 0] = "ACTIVITY_NOTIFICATIONS_UNSET";
		/**
		* @generated from protobuf enum value: GAME_ACTIVITY_NOTIFICATION_TYPE_ACTIVITY_NOTIFICATIONS_DISABLED = 1;
		*/
		PreloadedUserSettings_GameActivityNotificationType$1[PreloadedUserSettings_GameActivityNotificationType$1["ACTIVITY_NOTIFICATIONS_DISABLED"] = 1] = "ACTIVITY_NOTIFICATIONS_DISABLED";
		/**
		* @generated from protobuf enum value: GAME_ACTIVITY_NOTIFICATION_TYPE_ACTIVITY_NOTIFICATIONS_ENABLED = 2;
		*/
		PreloadedUserSettings_GameActivityNotificationType$1[PreloadedUserSettings_GameActivityNotificationType$1["ACTIVITY_NOTIFICATIONS_ENABLED"] = 2] = "ACTIVITY_NOTIFICATIONS_ENABLED";
		/**
		* @generated from protobuf enum value: GAME_ACTIVITY_NOTIFICATION_TYPE_ONLY_GAMES_PLAYED = 3;
		*/
		PreloadedUserSettings_GameActivityNotificationType$1[PreloadedUserSettings_GameActivityNotificationType$1["ONLY_GAMES_PLAYED"] = 3] = "ONLY_GAMES_PLAYED";
	})(PreloadedUserSettings_GameActivityNotificationType || (exports.PreloadedUserSettings_GameActivityNotificationType = PreloadedUserSettings_GameActivityNotificationType = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.CustomStatusPushNotificationType
	*/
	var PreloadedUserSettings_CustomStatusPushNotificationType;
	(function(PreloadedUserSettings_CustomStatusPushNotificationType$1) {
		/**
		* @generated from protobuf enum value: CUSTOM_STATUS_PUSH_NOTIFICATION_TYPE_STATUS_PUSH_UNSET = 0;
		*/
		PreloadedUserSettings_CustomStatusPushNotificationType$1[PreloadedUserSettings_CustomStatusPushNotificationType$1["STATUS_PUSH_UNSET"] = 0] = "STATUS_PUSH_UNSET";
		/**
		* @generated from protobuf enum value: CUSTOM_STATUS_PUSH_NOTIFICATION_TYPE_STATUS_PUSH_ENABLED = 1;
		*/
		PreloadedUserSettings_CustomStatusPushNotificationType$1[PreloadedUserSettings_CustomStatusPushNotificationType$1["STATUS_PUSH_ENABLED"] = 1] = "STATUS_PUSH_ENABLED";
		/**
		* @generated from protobuf enum value: CUSTOM_STATUS_PUSH_NOTIFICATION_TYPE_STATUS_PUSH_DISABLED = 2;
		*/
		PreloadedUserSettings_CustomStatusPushNotificationType$1[PreloadedUserSettings_CustomStatusPushNotificationType$1["STATUS_PUSH_DISABLED"] = 2] = "STATUS_PUSH_DISABLED";
	})(PreloadedUserSettings_CustomStatusPushNotificationType || (exports.PreloadedUserSettings_CustomStatusPushNotificationType = PreloadedUserSettings_CustomStatusPushNotificationType = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.GuildActivityStatusRestrictionDefault
	*/
	var PreloadedUserSettings_GuildActivityStatusRestrictionDefault;
	(function(PreloadedUserSettings_GuildActivityStatusRestrictionDefault$1) {
		/**
		* @generated from protobuf enum value: GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_OFF = 0;
		*/
		PreloadedUserSettings_GuildActivityStatusRestrictionDefault$1[PreloadedUserSettings_GuildActivityStatusRestrictionDefault$1["OFF"] = 0] = "OFF";
		/**
		* @generated from protobuf enum value: GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_ON_FOR_LARGE_GUILDS = 1;
		*/
		PreloadedUserSettings_GuildActivityStatusRestrictionDefault$1[PreloadedUserSettings_GuildActivityStatusRestrictionDefault$1["ON_FOR_LARGE_GUILDS"] = 1] = "ON_FOR_LARGE_GUILDS";
		/**
		* @generated from protobuf enum value: GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_ON = 2;
		*/
		PreloadedUserSettings_GuildActivityStatusRestrictionDefault$1[PreloadedUserSettings_GuildActivityStatusRestrictionDefault$1["ON"] = 2] = "ON";
	})(PreloadedUserSettings_GuildActivityStatusRestrictionDefault || (exports.PreloadedUserSettings_GuildActivityStatusRestrictionDefault = PreloadedUserSettings_GuildActivityStatusRestrictionDefault = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.GuildsLeaderboardOptOutDefault
	*/
	var PreloadedUserSettings_GuildsLeaderboardOptOutDefault;
	(function(PreloadedUserSettings_GuildsLeaderboardOptOutDefault$1) {
		/**
		* @generated from protobuf enum value: GUILDS_LEADERBOARD_OPT_OUT_DEFAULT_OFF_FOR_NEW_GUILDS = 0;
		*/
		PreloadedUserSettings_GuildsLeaderboardOptOutDefault$1[PreloadedUserSettings_GuildsLeaderboardOptOutDefault$1["OFF_FOR_NEW_GUILDS"] = 0] = "OFF_FOR_NEW_GUILDS";
		/**
		* @generated from protobuf enum value: GUILDS_LEADERBOARD_OPT_OUT_DEFAULT_ON_FOR_NEW_GUILDS = 1;
		*/
		PreloadedUserSettings_GuildsLeaderboardOptOutDefault$1[PreloadedUserSettings_GuildsLeaderboardOptOutDefault$1["ON_FOR_NEW_GUILDS"] = 1] = "ON_FOR_NEW_GUILDS";
	})(PreloadedUserSettings_GuildsLeaderboardOptOutDefault || (exports.PreloadedUserSettings_GuildsLeaderboardOptOutDefault = PreloadedUserSettings_GuildsLeaderboardOptOutDefault = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.SlayerSDKReceiveInGameDMs
	*/
	var PreloadedUserSettings_SlayerSDKReceiveInGameDMs;
	(function(PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1) {
		/**
		* @generated from protobuf enum value: SLAYER_SDK_RECEIVE_IN_GAME_DMS_UNSET = 0;
		*/
		PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1[PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1["SLAYER_SDK_RECEIVE_IN_GAME_DMS_UNSET"] = 0] = "SLAYER_SDK_RECEIVE_IN_GAME_DMS_UNSET";
		/**
		* @generated from protobuf enum value: SLAYER_SDK_RECEIVE_IN_GAME_DMS_ALL = 1;
		*/
		PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1[PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1["SLAYER_SDK_RECEIVE_IN_GAME_DMS_ALL"] = 1] = "SLAYER_SDK_RECEIVE_IN_GAME_DMS_ALL";
		/**
		* @generated from protobuf enum value: SLAYER_SDK_RECEIVE_IN_GAME_DMS_USERS_WITH_GAME = 2;
		*/
		PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1[PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1["SLAYER_SDK_RECEIVE_IN_GAME_DMS_USERS_WITH_GAME"] = 2] = "SLAYER_SDK_RECEIVE_IN_GAME_DMS_USERS_WITH_GAME";
		/**
		* @generated from protobuf enum value: SLAYER_SDK_RECEIVE_IN_GAME_DMS_NONE = 3;
		*/
		PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1[PreloadedUserSettings_SlayerSDKReceiveInGameDMs$1["SLAYER_SDK_RECEIVE_IN_GAME_DMS_NONE"] = 3] = "SLAYER_SDK_RECEIVE_IN_GAME_DMS_NONE";
	})(PreloadedUserSettings_SlayerSDKReceiveInGameDMs || (exports.PreloadedUserSettings_SlayerSDKReceiveInGameDMs = PreloadedUserSettings_SlayerSDKReceiveInGameDMs = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.GuildActivityStatusRestrictionDefaultV2
	*/
	var PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2;
	(function(PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1) {
		/**
		* @generated from protobuf enum value: GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_V2_ACTIVITY_STATUS_UNSET = 0;
		*/
		PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1[PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1["ACTIVITY_STATUS_UNSET"] = 0] = "ACTIVITY_STATUS_UNSET";
		/**
		* @generated from protobuf enum value: GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_V2_ACTIVITY_STATUS_OFF = 1;
		*/
		PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1[PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1["ACTIVITY_STATUS_OFF"] = 1] = "ACTIVITY_STATUS_OFF";
		/**
		* @generated from protobuf enum value: GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_V2_ACTIVITY_STATUS_ON_FOR_LARGE_GUILDS = 2;
		*/
		PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1[PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1["ACTIVITY_STATUS_ON_FOR_LARGE_GUILDS"] = 2] = "ACTIVITY_STATUS_ON_FOR_LARGE_GUILDS";
		/**
		* @generated from protobuf enum value: GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_V2_ACTIVITY_STATUS_ON = 3;
		*/
		PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1[PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2$1["ACTIVITY_STATUS_ON"] = 3] = "ACTIVITY_STATUS_ON";
	})(PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2 || (exports.PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2 = PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2 = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.Theme
	*/
	var PreloadedUserSettings_Theme;
	(function(PreloadedUserSettings_Theme$1) {
		/**
		* @generated from protobuf enum value: THEME_UNSET = 0;
		*/
		PreloadedUserSettings_Theme$1[PreloadedUserSettings_Theme$1["UNSET"] = 0] = "UNSET";
		/**
		* @generated from protobuf enum value: THEME_DARK = 1;
		*/
		PreloadedUserSettings_Theme$1[PreloadedUserSettings_Theme$1["DARK"] = 1] = "DARK";
		/**
		* @generated from protobuf enum value: THEME_LIGHT = 2;
		*/
		PreloadedUserSettings_Theme$1[PreloadedUserSettings_Theme$1["LIGHT"] = 2] = "LIGHT";
		/**
		* @generated from protobuf enum value: THEME_DARKER = 3;
		*/
		PreloadedUserSettings_Theme$1[PreloadedUserSettings_Theme$1["DARKER"] = 3] = "DARKER";
		/**
		* @generated from protobuf enum value: THEME_MIDNIGHT = 4;
		*/
		PreloadedUserSettings_Theme$1[PreloadedUserSettings_Theme$1["MIDNIGHT"] = 4] = "MIDNIGHT";
	})(PreloadedUserSettings_Theme || (exports.PreloadedUserSettings_Theme = PreloadedUserSettings_Theme = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.TimestampHourCycle
	*/
	var PreloadedUserSettings_TimestampHourCycle;
	(function(PreloadedUserSettings_TimestampHourCycle$1) {
		/**
		* @generated from protobuf enum value: TIMESTAMP_HOUR_CYCLE_AUTO = 0;
		*/
		PreloadedUserSettings_TimestampHourCycle$1[PreloadedUserSettings_TimestampHourCycle$1["AUTO"] = 0] = "AUTO";
		/**
		* @generated from protobuf enum value: TIMESTAMP_HOUR_CYCLE_H12 = 1;
		*/
		PreloadedUserSettings_TimestampHourCycle$1[PreloadedUserSettings_TimestampHourCycle$1["H12"] = 1] = "H12";
		/**
		* @generated from protobuf enum value: TIMESTAMP_HOUR_CYCLE_H23 = 2;
		*/
		PreloadedUserSettings_TimestampHourCycle$1[PreloadedUserSettings_TimestampHourCycle$1["H23"] = 2] = "H23";
	})(PreloadedUserSettings_TimestampHourCycle || (exports.PreloadedUserSettings_TimestampHourCycle = PreloadedUserSettings_TimestampHourCycle = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.LaunchPadMode
	*/
	var PreloadedUserSettings_LaunchPadMode;
	(function(PreloadedUserSettings_LaunchPadMode$1) {
		/**
		* @generated from protobuf enum value: LAUNCH_PAD_MODE_LAUNCH_PAD_DISABLED = 0;
		*/
		PreloadedUserSettings_LaunchPadMode$1[PreloadedUserSettings_LaunchPadMode$1["LAUNCH_PAD_DISABLED"] = 0] = "LAUNCH_PAD_DISABLED";
		/**
		* @generated from protobuf enum value: LAUNCH_PAD_MODE_LAUNCH_PAD_GESTURE_FULL_SCREEN = 1;
		*/
		PreloadedUserSettings_LaunchPadMode$1[PreloadedUserSettings_LaunchPadMode$1["LAUNCH_PAD_GESTURE_FULL_SCREEN"] = 1] = "LAUNCH_PAD_GESTURE_FULL_SCREEN";
		/**
		* @generated from protobuf enum value: LAUNCH_PAD_MODE_LAUNCH_PAD_GESTURE_RIGHT_EDGE = 2;
		*/
		PreloadedUserSettings_LaunchPadMode$1[PreloadedUserSettings_LaunchPadMode$1["LAUNCH_PAD_GESTURE_RIGHT_EDGE"] = 2] = "LAUNCH_PAD_GESTURE_RIGHT_EDGE";
		/**
		* @generated from protobuf enum value: LAUNCH_PAD_MODE_LAUNCH_PAD_PULL_TAB = 3;
		*/
		PreloadedUserSettings_LaunchPadMode$1[PreloadedUserSettings_LaunchPadMode$1["LAUNCH_PAD_PULL_TAB"] = 3] = "LAUNCH_PAD_PULL_TAB";
	})(PreloadedUserSettings_LaunchPadMode || (exports.PreloadedUserSettings_LaunchPadMode = PreloadedUserSettings_LaunchPadMode = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.UIDensity
	*/
	var PreloadedUserSettings_UIDensity;
	(function(PreloadedUserSettings_UIDensity$1) {
		/**
		* @generated from protobuf enum value: UI_DENSITY_UNSET_UI_DENSITY = 0;
		*/
		PreloadedUserSettings_UIDensity$1[PreloadedUserSettings_UIDensity$1["UI_DENSITY_UNSET_UI_DENSITY"] = 0] = "UI_DENSITY_UNSET_UI_DENSITY";
		/**
		* @generated from protobuf enum value: UI_DENSITY_COMPACT = 1;
		*/
		PreloadedUserSettings_UIDensity$1[PreloadedUserSettings_UIDensity$1["UI_DENSITY_COMPACT"] = 1] = "UI_DENSITY_COMPACT";
		/**
		* @generated from protobuf enum value: UI_DENSITY_COZY = 2;
		*/
		PreloadedUserSettings_UIDensity$1[PreloadedUserSettings_UIDensity$1["UI_DENSITY_COZY"] = 2] = "UI_DENSITY_COZY";
		/**
		* @generated from protobuf enum value: UI_DENSITY_RESPONSIVE = 3;
		*/
		PreloadedUserSettings_UIDensity$1[PreloadedUserSettings_UIDensity$1["UI_DENSITY_RESPONSIVE"] = 3] = "UI_DENSITY_RESPONSIVE";
		/**
		* @generated from protobuf enum value: UI_DENSITY_DEFAULT = 4;
		*/
		PreloadedUserSettings_UIDensity$1[PreloadedUserSettings_UIDensity$1["UI_DENSITY_DEFAULT"] = 4] = "UI_DENSITY_DEFAULT";
	})(PreloadedUserSettings_UIDensity || (exports.PreloadedUserSettings_UIDensity = PreloadedUserSettings_UIDensity = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.SwipeRightToLeftMode
	*/
	var PreloadedUserSettings_SwipeRightToLeftMode;
	(function(PreloadedUserSettings_SwipeRightToLeftMode$1) {
		/**
		* @generated from protobuf enum value: SWIPE_RIGHT_TO_LEFT_MODE_SWIPE_RIGHT_TO_LEFT_UNSET = 0;
		*/
		PreloadedUserSettings_SwipeRightToLeftMode$1[PreloadedUserSettings_SwipeRightToLeftMode$1["SWIPE_RIGHT_TO_LEFT_UNSET"] = 0] = "SWIPE_RIGHT_TO_LEFT_UNSET";
		/**
		* @generated from protobuf enum value: SWIPE_RIGHT_TO_LEFT_MODE_SWIPE_RIGHT_TO_LEFT_CHANNEL_DETAILS = 1;
		*/
		PreloadedUserSettings_SwipeRightToLeftMode$1[PreloadedUserSettings_SwipeRightToLeftMode$1["SWIPE_RIGHT_TO_LEFT_CHANNEL_DETAILS"] = 1] = "SWIPE_RIGHT_TO_LEFT_CHANNEL_DETAILS";
		/**
		* @generated from protobuf enum value: SWIPE_RIGHT_TO_LEFT_MODE_SWIPE_RIGHT_TO_LEFT_REPLY = 2;
		*/
		PreloadedUserSettings_SwipeRightToLeftMode$1[PreloadedUserSettings_SwipeRightToLeftMode$1["SWIPE_RIGHT_TO_LEFT_REPLY"] = 2] = "SWIPE_RIGHT_TO_LEFT_REPLY";
	})(PreloadedUserSettings_SwipeRightToLeftMode || (exports.PreloadedUserSettings_SwipeRightToLeftMode = PreloadedUserSettings_SwipeRightToLeftMode = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.FavoriteChannelType
	*/
	var PreloadedUserSettings_FavoriteChannelType;
	(function(PreloadedUserSettings_FavoriteChannelType$1) {
		/**
		* @generated from protobuf enum value: FAVORITE_CHANNEL_TYPE_UNSET_FAVORITE_CHANNEL_TYPE = 0;
		*/
		PreloadedUserSettings_FavoriteChannelType$1[PreloadedUserSettings_FavoriteChannelType$1["UNSET_FAVORITE_CHANNEL_TYPE"] = 0] = "UNSET_FAVORITE_CHANNEL_TYPE";
		/**
		* @generated from protobuf enum value: FAVORITE_CHANNEL_TYPE_REFERENCE_ORIGINAL = 1;
		*/
		PreloadedUserSettings_FavoriteChannelType$1[PreloadedUserSettings_FavoriteChannelType$1["REFERENCE_ORIGINAL"] = 1] = "REFERENCE_ORIGINAL";
		/**
		* @generated from protobuf enum value: FAVORITE_CHANNEL_TYPE_CATEGORY = 2;
		*/
		PreloadedUserSettings_FavoriteChannelType$1[PreloadedUserSettings_FavoriteChannelType$1["CATEGORY"] = 2] = "CATEGORY";
	})(PreloadedUserSettings_FavoriteChannelType || (exports.PreloadedUserSettings_FavoriteChannelType = PreloadedUserSettings_FavoriteChannelType = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.ForLaterTab
	*/
	var PreloadedUserSettings_ForLaterTab;
	(function(PreloadedUserSettings_ForLaterTab$1) {
		/**
		* @generated from protobuf enum value: FOR_LATER_TAB_UNSPECIFIED = 0;
		*/
		PreloadedUserSettings_ForLaterTab$1[PreloadedUserSettings_ForLaterTab$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: FOR_LATER_TAB_ALL = 1;
		*/
		PreloadedUserSettings_ForLaterTab$1[PreloadedUserSettings_ForLaterTab$1["ALL"] = 1] = "ALL";
		/**
		* @generated from protobuf enum value: FOR_LATER_TAB_BOOKMARKS = 2;
		*/
		PreloadedUserSettings_ForLaterTab$1[PreloadedUserSettings_ForLaterTab$1["BOOKMARKS"] = 2] = "BOOKMARKS";
		/**
		* @generated from protobuf enum value: FOR_LATER_TAB_REMINDERS = 3;
		*/
		PreloadedUserSettings_ForLaterTab$1[PreloadedUserSettings_ForLaterTab$1["REMINDERS"] = 3] = "REMINDERS";
	})(PreloadedUserSettings_ForLaterTab || (exports.PreloadedUserSettings_ForLaterTab = PreloadedUserSettings_ForLaterTab = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.PreloadedUserSettings.SafetySettingsPresetType
	*/
	var PreloadedUserSettings_SafetySettingsPresetType;
	(function(PreloadedUserSettings_SafetySettingsPresetType$1) {
		/**
		* @generated from protobuf enum value: SAFETY_SETTINGS_PRESET_TYPE_UNSET_SAFETY_SETTINGS_PRESET = 0;
		*/
		PreloadedUserSettings_SafetySettingsPresetType$1[PreloadedUserSettings_SafetySettingsPresetType$1["UNSET_SAFETY_SETTINGS_PRESET"] = 0] = "UNSET_SAFETY_SETTINGS_PRESET";
		/**
		* @generated from protobuf enum value: SAFETY_SETTINGS_PRESET_TYPE_BALANCED = 1;
		*/
		PreloadedUserSettings_SafetySettingsPresetType$1[PreloadedUserSettings_SafetySettingsPresetType$1["BALANCED"] = 1] = "BALANCED";
		/**
		* @generated from protobuf enum value: SAFETY_SETTINGS_PRESET_TYPE_STRICT = 2;
		*/
		PreloadedUserSettings_SafetySettingsPresetType$1[PreloadedUserSettings_SafetySettingsPresetType$1["STRICT"] = 2] = "STRICT";
		/**
		* @generated from protobuf enum value: SAFETY_SETTINGS_PRESET_TYPE_RELAXED = 3;
		*/
		PreloadedUserSettings_SafetySettingsPresetType$1[PreloadedUserSettings_SafetySettingsPresetType$1["RELAXED"] = 3] = "RELAXED";
		/**
		* @generated from protobuf enum value: SAFETY_SETTINGS_PRESET_TYPE_CUSTOM = 4;
		*/
		PreloadedUserSettings_SafetySettingsPresetType$1[PreloadedUserSettings_SafetySettingsPresetType$1["CUSTOM"] = 4] = "CUSTOM";
	})(PreloadedUserSettings_SafetySettingsPresetType || (exports.PreloadedUserSettings_SafetySettingsPresetType = PreloadedUserSettings_SafetySettingsPresetType = {}));
	var PreloadedUserSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings", [
				{
					no: 1,
					name: "versions",
					kind: "message",
					T: () => exports.PreloadedUserSettings_Versions
				},
				{
					no: 2,
					name: "inbox",
					kind: "message",
					T: () => exports.PreloadedUserSettings_InboxSettings
				},
				{
					no: 3,
					name: "guilds",
					kind: "message",
					T: () => exports.PreloadedUserSettings_AllGuildSettings
				},
				{
					no: 4,
					name: "user_content",
					kind: "message",
					T: () => exports.PreloadedUserSettings_UserContentSettings
				},
				{
					no: 5,
					name: "voice_and_video",
					kind: "message",
					T: () => exports.PreloadedUserSettings_VoiceAndVideoSettings
				},
				{
					no: 6,
					name: "text_and_images",
					kind: "message",
					T: () => exports.PreloadedUserSettings_TextAndImagesSettings
				},
				{
					no: 7,
					name: "notifications",
					kind: "message",
					T: () => exports.PreloadedUserSettings_NotificationSettings
				},
				{
					no: 8,
					name: "privacy",
					kind: "message",
					T: () => exports.PreloadedUserSettings_PrivacySettings
				},
				{
					no: 9,
					name: "debug",
					kind: "message",
					T: () => exports.PreloadedUserSettings_DebugSettings
				},
				{
					no: 10,
					name: "game_library",
					kind: "message",
					T: () => exports.PreloadedUserSettings_GameLibrarySettings
				},
				{
					no: 11,
					name: "status",
					kind: "message",
					T: () => exports.PreloadedUserSettings_StatusSettings
				},
				{
					no: 12,
					name: "localization",
					kind: "message",
					T: () => exports.PreloadedUserSettings_LocalizationSettings
				},
				{
					no: 13,
					name: "appearance",
					kind: "message",
					T: () => exports.PreloadedUserSettings_AppearanceSettings
				},
				{
					no: 14,
					name: "guild_folders",
					kind: "message",
					T: () => exports.PreloadedUserSettings_GuildFolders
				},
				{
					no: 15,
					name: "favorites",
					kind: "message",
					T: () => exports.PreloadedUserSettings_Favorites
				},
				{
					no: 16,
					name: "audio_context_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_AudioSettings
				},
				{
					no: 17,
					name: "communities",
					kind: "message",
					T: () => exports.PreloadedUserSettings_CommunitiesSettings
				},
				{
					no: 18,
					name: "broadcast",
					kind: "message",
					T: () => exports.PreloadedUserSettings_BroadcastSettings
				},
				{
					no: 19,
					name: "clips",
					kind: "message",
					T: () => exports.PreloadedUserSettings_ClipsSettings
				},
				{
					no: 20,
					name: "for_later",
					kind: "message",
					T: () => exports.PreloadedUserSettings_ForLaterSettings
				},
				{
					no: 21,
					name: "safety_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_SafetySettings
				},
				{
					no: 22,
					name: "icymi_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_ICYMISettings
				},
				{
					no: 23,
					name: "applications",
					kind: "message",
					T: () => exports.PreloadedUserSettings_AllApplicationSettings
				},
				{
					no: 24,
					name: "ads",
					kind: "message",
					T: () => exports.PreloadedUserSettings_AdsSettings
				},
				{
					no: 25,
					name: "in_app_feedback_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_InAppFeedbackSettings
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.versions = exports.PreloadedUserSettings_Versions.internalBinaryRead(reader, reader.uint32(), options, message.versions);
						break;
					case 2:
						message.inbox = exports.PreloadedUserSettings_InboxSettings.internalBinaryRead(reader, reader.uint32(), options, message.inbox);
						break;
					case 3:
						message.guilds = exports.PreloadedUserSettings_AllGuildSettings.internalBinaryRead(reader, reader.uint32(), options, message.guilds);
						break;
					case 4:
						message.userContent = exports.PreloadedUserSettings_UserContentSettings.internalBinaryRead(reader, reader.uint32(), options, message.userContent);
						break;
					case 5:
						message.voiceAndVideo = exports.PreloadedUserSettings_VoiceAndVideoSettings.internalBinaryRead(reader, reader.uint32(), options, message.voiceAndVideo);
						break;
					case 6:
						message.textAndImages = exports.PreloadedUserSettings_TextAndImagesSettings.internalBinaryRead(reader, reader.uint32(), options, message.textAndImages);
						break;
					case 7:
						message.notifications = exports.PreloadedUserSettings_NotificationSettings.internalBinaryRead(reader, reader.uint32(), options, message.notifications);
						break;
					case 8:
						message.privacy = exports.PreloadedUserSettings_PrivacySettings.internalBinaryRead(reader, reader.uint32(), options, message.privacy);
						break;
					case 9:
						message.debug = exports.PreloadedUserSettings_DebugSettings.internalBinaryRead(reader, reader.uint32(), options, message.debug);
						break;
					case 10:
						message.gameLibrary = exports.PreloadedUserSettings_GameLibrarySettings.internalBinaryRead(reader, reader.uint32(), options, message.gameLibrary);
						break;
					case 11:
						message.status = exports.PreloadedUserSettings_StatusSettings.internalBinaryRead(reader, reader.uint32(), options, message.status);
						break;
					case 12:
						message.localization = exports.PreloadedUserSettings_LocalizationSettings.internalBinaryRead(reader, reader.uint32(), options, message.localization);
						break;
					case 13:
						message.appearance = exports.PreloadedUserSettings_AppearanceSettings.internalBinaryRead(reader, reader.uint32(), options, message.appearance);
						break;
					case 14:
						message.guildFolders = exports.PreloadedUserSettings_GuildFolders.internalBinaryRead(reader, reader.uint32(), options, message.guildFolders);
						break;
					case 15:
						message.favorites = exports.PreloadedUserSettings_Favorites.internalBinaryRead(reader, reader.uint32(), options, message.favorites);
						break;
					case 16:
						message.audioContextSettings = exports.PreloadedUserSettings_AudioSettings.internalBinaryRead(reader, reader.uint32(), options, message.audioContextSettings);
						break;
					case 17:
						message.communities = exports.PreloadedUserSettings_CommunitiesSettings.internalBinaryRead(reader, reader.uint32(), options, message.communities);
						break;
					case 18:
						message.broadcast = exports.PreloadedUserSettings_BroadcastSettings.internalBinaryRead(reader, reader.uint32(), options, message.broadcast);
						break;
					case 19:
						message.clips = exports.PreloadedUserSettings_ClipsSettings.internalBinaryRead(reader, reader.uint32(), options, message.clips);
						break;
					case 20:
						message.forLater = exports.PreloadedUserSettings_ForLaterSettings.internalBinaryRead(reader, reader.uint32(), options, message.forLater);
						break;
					case 21:
						message.safetySettings = exports.PreloadedUserSettings_SafetySettings.internalBinaryRead(reader, reader.uint32(), options, message.safetySettings);
						break;
					case 22:
						message.icymiSettings = exports.PreloadedUserSettings_ICYMISettings.internalBinaryRead(reader, reader.uint32(), options, message.icymiSettings);
						break;
					case 23:
						message.applications = exports.PreloadedUserSettings_AllApplicationSettings.internalBinaryRead(reader, reader.uint32(), options, message.applications);
						break;
					case 24:
						message.ads = exports.PreloadedUserSettings_AdsSettings.internalBinaryRead(reader, reader.uint32(), options, message.ads);
						break;
					case 25:
						message.inAppFeedbackSettings = exports.PreloadedUserSettings_InAppFeedbackSettings.internalBinaryRead(reader, reader.uint32(), options, message.inAppFeedbackSettings);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.versions) exports.PreloadedUserSettings_Versions.internalBinaryWrite(message.versions, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.inbox) exports.PreloadedUserSettings_InboxSettings.internalBinaryWrite(message.inbox, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.guilds) exports.PreloadedUserSettings_AllGuildSettings.internalBinaryWrite(message.guilds, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.userContent) exports.PreloadedUserSettings_UserContentSettings.internalBinaryWrite(message.userContent, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.voiceAndVideo) exports.PreloadedUserSettings_VoiceAndVideoSettings.internalBinaryWrite(message.voiceAndVideo, writer.tag(5, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.textAndImages) exports.PreloadedUserSettings_TextAndImagesSettings.internalBinaryWrite(message.textAndImages, writer.tag(6, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.notifications) exports.PreloadedUserSettings_NotificationSettings.internalBinaryWrite(message.notifications, writer.tag(7, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.privacy) exports.PreloadedUserSettings_PrivacySettings.internalBinaryWrite(message.privacy, writer.tag(8, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.debug) exports.PreloadedUserSettings_DebugSettings.internalBinaryWrite(message.debug, writer.tag(9, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.gameLibrary) exports.PreloadedUserSettings_GameLibrarySettings.internalBinaryWrite(message.gameLibrary, writer.tag(10, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.status) exports.PreloadedUserSettings_StatusSettings.internalBinaryWrite(message.status, writer.tag(11, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.localization) exports.PreloadedUserSettings_LocalizationSettings.internalBinaryWrite(message.localization, writer.tag(12, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.appearance) exports.PreloadedUserSettings_AppearanceSettings.internalBinaryWrite(message.appearance, writer.tag(13, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.guildFolders) exports.PreloadedUserSettings_GuildFolders.internalBinaryWrite(message.guildFolders, writer.tag(14, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.favorites) exports.PreloadedUserSettings_Favorites.internalBinaryWrite(message.favorites, writer.tag(15, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.audioContextSettings) exports.PreloadedUserSettings_AudioSettings.internalBinaryWrite(message.audioContextSettings, writer.tag(16, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.communities) exports.PreloadedUserSettings_CommunitiesSettings.internalBinaryWrite(message.communities, writer.tag(17, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.broadcast) exports.PreloadedUserSettings_BroadcastSettings.internalBinaryWrite(message.broadcast, writer.tag(18, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.clips) exports.PreloadedUserSettings_ClipsSettings.internalBinaryWrite(message.clips, writer.tag(19, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.forLater) exports.PreloadedUserSettings_ForLaterSettings.internalBinaryWrite(message.forLater, writer.tag(20, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.safetySettings) exports.PreloadedUserSettings_SafetySettings.internalBinaryWrite(message.safetySettings, writer.tag(21, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.icymiSettings) exports.PreloadedUserSettings_ICYMISettings.internalBinaryWrite(message.icymiSettings, writer.tag(22, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.applications) exports.PreloadedUserSettings_AllApplicationSettings.internalBinaryWrite(message.applications, writer.tag(23, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.ads) exports.PreloadedUserSettings_AdsSettings.internalBinaryWrite(message.ads, writer.tag(24, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.inAppFeedbackSettings) exports.PreloadedUserSettings_InAppFeedbackSettings.internalBinaryWrite(message.inAppFeedbackSettings, writer.tag(25, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings
	*/
	exports.PreloadedUserSettings = new PreloadedUserSettings$Type();
	var PreloadedUserSettings_Versions$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.Versions", [
				{
					no: 1,
					name: "client_version",
					kind: "scalar",
					T: 13
				},
				{
					no: 2,
					name: "server_version",
					kind: "scalar",
					T: 13
				},
				{
					no: 3,
					name: "data_version",
					kind: "scalar",
					T: 13
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.clientVersion = 0;
			message.serverVersion = 0;
			message.dataVersion = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.clientVersion = reader.uint32();
						break;
					case 2:
						message.serverVersion = reader.uint32();
						break;
					case 3:
						message.dataVersion = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.clientVersion !== 0) writer.tag(1, runtime_1$8.WireType.Varint).uint32(message.clientVersion);
			if (message.serverVersion !== 0) writer.tag(2, runtime_1$8.WireType.Varint).uint32(message.serverVersion);
			if (message.dataVersion !== 0) writer.tag(3, runtime_1$8.WireType.Varint).uint32(message.dataVersion);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.Versions
	*/
	exports.PreloadedUserSettings_Versions = new PreloadedUserSettings_Versions$Type();
	var PreloadedUserSettings_InboxSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.InboxSettings", [{
				no: 1,
				name: "current_tab",
				kind: "enum",
				T: () => [
					"discord_protos.discord_users.v1.PreloadedUserSettings.InboxTab",
					PreloadedUserSettings_InboxTab,
					"INBOX_TAB_"
				]
			}, {
				no: 2,
				name: "viewed_tutorial",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.currentTab = 0;
			message.viewedTutorial = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.currentTab = reader.int32();
						break;
					case 2:
						message.viewedTutorial = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.currentTab !== 0) writer.tag(1, runtime_1$8.WireType.Varint).int32(message.currentTab);
			if (message.viewedTutorial !== false) writer.tag(2, runtime_1$8.WireType.Varint).bool(message.viewedTutorial);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.InboxSettings
	*/
	exports.PreloadedUserSettings_InboxSettings = new PreloadedUserSettings_InboxSettings$Type();
	var PreloadedUserSettings_ChannelIconEmoji$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ChannelIconEmoji", [
				{
					no: 1,
					name: "id",
					kind: "message",
					T: () => wrappers_7.UInt64Value
				},
				{
					no: 2,
					name: "name",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 3,
					name: "color",
					kind: "message",
					T: () => wrappers_7.UInt64Value
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.id = wrappers_7.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.id);
						break;
					case 2:
						message.name = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.name);
						break;
					case 3:
						message.color = wrappers_7.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.color);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.id) wrappers_7.UInt64Value.internalBinaryWrite(message.id, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.name) wrappers_6.StringValue.internalBinaryWrite(message.name, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.color) wrappers_7.UInt64Value.internalBinaryWrite(message.color, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ChannelIconEmoji
	*/
	exports.PreloadedUserSettings_ChannelIconEmoji = new PreloadedUserSettings_ChannelIconEmoji$Type();
	var PreloadedUserSettings_CustomNotificationSoundConfig$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.CustomNotificationSoundConfig", [{
				no: 1,
				name: "notification_sound_pack_id",
				kind: "message",
				T: () => wrappers_6.StringValue
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.notificationSoundPackId = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.notificationSoundPackId);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.notificationSoundPackId) wrappers_6.StringValue.internalBinaryWrite(message.notificationSoundPackId, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.CustomNotificationSoundConfig
	*/
	exports.PreloadedUserSettings_CustomNotificationSoundConfig = new PreloadedUserSettings_CustomNotificationSoundConfig$Type();
	var PreloadedUserSettings_ChannelSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ChannelSettings", [
				{
					no: 1,
					name: "collapsed_in_inbox",
					kind: "scalar",
					T: 8
				},
				{
					no: 2,
					name: "icon_emoji",
					kind: "message",
					T: () => exports.PreloadedUserSettings_ChannelIconEmoji
				},
				{
					no: 3,
					name: "custom_notification_sound_config",
					kind: "message",
					T: () => exports.PreloadedUserSettings_CustomNotificationSoundConfig
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.collapsedInInbox = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.collapsedInInbox = reader.bool();
						break;
					case 2:
						message.iconEmoji = exports.PreloadedUserSettings_ChannelIconEmoji.internalBinaryRead(reader, reader.uint32(), options, message.iconEmoji);
						break;
					case 3:
						message.customNotificationSoundConfig = exports.PreloadedUserSettings_CustomNotificationSoundConfig.internalBinaryRead(reader, reader.uint32(), options, message.customNotificationSoundConfig);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.collapsedInInbox !== false) writer.tag(1, runtime_1$8.WireType.Varint).bool(message.collapsedInInbox);
			if (message.iconEmoji) exports.PreloadedUserSettings_ChannelIconEmoji.internalBinaryWrite(message.iconEmoji, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.customNotificationSoundConfig) exports.PreloadedUserSettings_CustomNotificationSoundConfig.internalBinaryWrite(message.customNotificationSoundConfig, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ChannelSettings
	*/
	exports.PreloadedUserSettings_ChannelSettings = new PreloadedUserSettings_ChannelSettings$Type();
	var PreloadedUserSettings_CustomCallSound$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.CustomCallSound", [{
				no: 1,
				name: "sound_id",
				kind: "scalar",
				T: 6,
				L: 0
			}, {
				no: 2,
				name: "guild_id",
				kind: "scalar",
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.soundId = 0n;
			message.guildId = 0n;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.soundId = reader.fixed64().toBigInt();
						break;
					case 2:
						message.guildId = reader.fixed64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.soundId !== 0n) writer.tag(1, runtime_1$8.WireType.Bit64).fixed64(message.soundId);
			if (message.guildId !== 0n) writer.tag(2, runtime_1$8.WireType.Bit64).fixed64(message.guildId);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.CustomCallSound
	*/
	exports.PreloadedUserSettings_CustomCallSound = new PreloadedUserSettings_CustomCallSound$Type();
	var PreloadedUserSettings_ChannelListSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ChannelListSettings", [{
				no: 1,
				name: "layout",
				kind: "message",
				T: () => wrappers_6.StringValue
			}, {
				no: 2,
				name: "message_previews",
				kind: "message",
				T: () => wrappers_6.StringValue
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.layout = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.layout);
						break;
					case 2:
						message.messagePreviews = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.messagePreviews);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.layout) wrappers_6.StringValue.internalBinaryWrite(message.layout, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.messagePreviews) wrappers_6.StringValue.internalBinaryWrite(message.messagePreviews, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ChannelListSettings
	*/
	exports.PreloadedUserSettings_ChannelListSettings = new PreloadedUserSettings_ChannelListSettings$Type();
	var PreloadedUserSettings_GuildDismissibleContentState$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.GuildDismissibleContentState", [
				{
					no: 1,
					name: "dismissed",
					kind: "scalar",
					T: 8
				},
				{
					no: 2,
					name: "last_dismissed_version",
					kind: "scalar",
					T: 13
				},
				{
					no: 3,
					name: "last_dismissed_at_ms",
					kind: "scalar",
					T: 4,
					L: 0
				},
				{
					no: 4,
					name: "last_dismissed_object_id",
					kind: "scalar",
					T: 4,
					L: 0
				},
				{
					no: 5,
					name: "num_times_dismissed",
					kind: "scalar",
					T: 13
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.dismissed = false;
			message.lastDismissedVersion = 0;
			message.lastDismissedAtMs = 0n;
			message.lastDismissedObjectId = 0n;
			message.numTimesDismissed = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.dismissed = reader.bool();
						break;
					case 2:
						message.lastDismissedVersion = reader.uint32();
						break;
					case 3:
						message.lastDismissedAtMs = reader.uint64().toBigInt();
						break;
					case 4:
						message.lastDismissedObjectId = reader.uint64().toBigInt();
						break;
					case 5:
						message.numTimesDismissed = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.dismissed !== false) writer.tag(1, runtime_1$8.WireType.Varint).bool(message.dismissed);
			if (message.lastDismissedVersion !== 0) writer.tag(2, runtime_1$8.WireType.Varint).uint32(message.lastDismissedVersion);
			if (message.lastDismissedAtMs !== 0n) writer.tag(3, runtime_1$8.WireType.Varint).uint64(message.lastDismissedAtMs);
			if (message.lastDismissedObjectId !== 0n) writer.tag(4, runtime_1$8.WireType.Varint).uint64(message.lastDismissedObjectId);
			if (message.numTimesDismissed !== 0) writer.tag(5, runtime_1$8.WireType.Varint).uint32(message.numTimesDismissed);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.GuildDismissibleContentState
	*/
	exports.PreloadedUserSettings_GuildDismissibleContentState = new PreloadedUserSettings_GuildDismissibleContentState$Type();
	var PreloadedUserSettings_GuildSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.GuildSettings", [
				{
					no: 1,
					name: "channels",
					kind: "map",
					K: 6,
					V: {
						kind: "message",
						T: () => exports.PreloadedUserSettings_ChannelSettings
					}
				},
				{
					no: 2,
					name: "hub_progress",
					kind: "scalar",
					T: 13
				},
				{
					no: 3,
					name: "guild_onboarding_progress",
					kind: "scalar",
					T: 13
				},
				{
					no: 4,
					name: "guild_recents_dismissed_at",
					kind: "message",
					T: () => timestamp_1$2.Timestamp
				},
				{
					no: 5,
					name: "dismissed_guild_content",
					kind: "scalar",
					T: 12
				},
				{
					no: 6,
					name: "join_sound",
					kind: "message",
					T: () => exports.PreloadedUserSettings_CustomCallSound
				},
				{
					no: 7,
					name: "mobile_redesign_channel_list_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_ChannelListSettings
				},
				{
					no: 8,
					name: "disable_raid_alert_push",
					kind: "scalar",
					T: 8
				},
				{
					no: 9,
					name: "disable_raid_alert_nag",
					kind: "scalar",
					T: 8
				},
				{
					no: 10,
					name: "custom_notification_sound_config",
					kind: "message",
					T: () => exports.PreloadedUserSettings_CustomNotificationSoundConfig
				},
				{
					no: 11,
					name: "leaderboards_disabled",
					kind: "scalar",
					T: 8
				},
				{
					no: 12,
					name: "guild_dismissible_content_states",
					kind: "map",
					K: 5,
					V: {
						kind: "message",
						T: () => exports.PreloadedUserSettings_GuildDismissibleContentState
					}
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.channels = {};
			message.hubProgress = 0;
			message.guildOnboardingProgress = 0;
			message.dismissedGuildContent = new Uint8Array(0);
			message.disableRaidAlertPush = false;
			message.disableRaidAlertNag = false;
			message.leaderboardsDisabled = false;
			message.guildDismissibleContentStates = {};
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.channels, reader, options);
						break;
					case 2:
						message.hubProgress = reader.uint32();
						break;
					case 3:
						message.guildOnboardingProgress = reader.uint32();
						break;
					case 4:
						message.guildRecentsDismissedAt = timestamp_1$2.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.guildRecentsDismissedAt);
						break;
					case 5:
						message.dismissedGuildContent = reader.bytes();
						break;
					case 6:
						message.joinSound = exports.PreloadedUserSettings_CustomCallSound.internalBinaryRead(reader, reader.uint32(), options, message.joinSound);
						break;
					case 7:
						message.mobileRedesignChannelListSettings = exports.PreloadedUserSettings_ChannelListSettings.internalBinaryRead(reader, reader.uint32(), options, message.mobileRedesignChannelListSettings);
						break;
					case 8:
						message.disableRaidAlertPush = reader.bool();
						break;
					case 9:
						message.disableRaidAlertNag = reader.bool();
						break;
					case 10:
						message.customNotificationSoundConfig = exports.PreloadedUserSettings_CustomNotificationSoundConfig.internalBinaryRead(reader, reader.uint32(), options, message.customNotificationSoundConfig);
						break;
					case 11:
						message.leaderboardsDisabled = reader.bool();
						break;
					case 12:
						this.binaryReadMap12(message.guildDismissibleContentStates, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.PreloadedUserSettings_ChannelSettings.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.GuildSettings.channels");
				}
			}
			map[key ?? "0"] = val ?? exports.PreloadedUserSettings_ChannelSettings.create();
		}
		binaryReadMap12(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.int32();
						break;
					case 2:
						val = exports.PreloadedUserSettings_GuildDismissibleContentState.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.GuildSettings.guild_dismissible_content_states");
				}
			}
			map[key ?? 0] = val ?? exports.PreloadedUserSettings_GuildDismissibleContentState.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.channels)) {
				writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_ChannelSettings.internalBinaryWrite(message.channels[k], writer, options);
				writer.join().join();
			}
			if (message.hubProgress !== 0) writer.tag(2, runtime_1$8.WireType.Varint).uint32(message.hubProgress);
			if (message.guildOnboardingProgress !== 0) writer.tag(3, runtime_1$8.WireType.Varint).uint32(message.guildOnboardingProgress);
			if (message.guildRecentsDismissedAt) timestamp_1$2.Timestamp.internalBinaryWrite(message.guildRecentsDismissedAt, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.dismissedGuildContent.length) writer.tag(5, runtime_1$8.WireType.LengthDelimited).bytes(message.dismissedGuildContent);
			if (message.joinSound) exports.PreloadedUserSettings_CustomCallSound.internalBinaryWrite(message.joinSound, writer.tag(6, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.mobileRedesignChannelListSettings) exports.PreloadedUserSettings_ChannelListSettings.internalBinaryWrite(message.mobileRedesignChannelListSettings, writer.tag(7, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.disableRaidAlertPush !== false) writer.tag(8, runtime_1$8.WireType.Varint).bool(message.disableRaidAlertPush);
			if (message.disableRaidAlertNag !== false) writer.tag(9, runtime_1$8.WireType.Varint).bool(message.disableRaidAlertNag);
			if (message.customNotificationSoundConfig) exports.PreloadedUserSettings_CustomNotificationSoundConfig.internalBinaryWrite(message.customNotificationSoundConfig, writer.tag(10, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.leaderboardsDisabled !== false) writer.tag(11, runtime_1$8.WireType.Varint).bool(message.leaderboardsDisabled);
			for (let k of globalThis.Object.keys(message.guildDismissibleContentStates)) {
				writer.tag(12, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Varint).int32(parseInt(k));
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_GuildDismissibleContentState.internalBinaryWrite(message.guildDismissibleContentStates[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.GuildSettings
	*/
	exports.PreloadedUserSettings_GuildSettings = new PreloadedUserSettings_GuildSettings$Type();
	var PreloadedUserSettings_AllGuildSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.AllGuildSettings", [{
				no: 1,
				name: "guilds",
				kind: "map",
				K: 6,
				V: {
					kind: "message",
					T: () => exports.PreloadedUserSettings_GuildSettings
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.guilds = {};
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.guilds, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.PreloadedUserSettings_GuildSettings.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.AllGuildSettings.guilds");
				}
			}
			map[key ?? "0"] = val ?? exports.PreloadedUserSettings_GuildSettings.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.guilds)) {
				writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_GuildSettings.internalBinaryWrite(message.guilds[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.AllGuildSettings
	*/
	exports.PreloadedUserSettings_AllGuildSettings = new PreloadedUserSettings_AllGuildSettings$Type();
	var PreloadedUserSettings_RecurringDismissibleContentState$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.RecurringDismissibleContentState", [
				{
					no: 1,
					name: "last_dismissed_version",
					kind: "scalar",
					T: 13
				},
				{
					no: 2,
					name: "last_dismissed_at_ms",
					kind: "scalar",
					T: 4,
					L: 0
				},
				{
					no: 3,
					name: "last_dismissed_object_id",
					kind: "scalar",
					T: 4,
					L: 0
				},
				{
					no: 4,
					name: "num_times_dismissed",
					kind: "scalar",
					T: 13
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.lastDismissedVersion = 0;
			message.lastDismissedAtMs = 0n;
			message.lastDismissedObjectId = 0n;
			message.numTimesDismissed = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.lastDismissedVersion = reader.uint32();
						break;
					case 2:
						message.lastDismissedAtMs = reader.uint64().toBigInt();
						break;
					case 3:
						message.lastDismissedObjectId = reader.uint64().toBigInt();
						break;
					case 4:
						message.numTimesDismissed = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.lastDismissedVersion !== 0) writer.tag(1, runtime_1$8.WireType.Varint).uint32(message.lastDismissedVersion);
			if (message.lastDismissedAtMs !== 0n) writer.tag(2, runtime_1$8.WireType.Varint).uint64(message.lastDismissedAtMs);
			if (message.lastDismissedObjectId !== 0n) writer.tag(3, runtime_1$8.WireType.Varint).uint64(message.lastDismissedObjectId);
			if (message.numTimesDismissed !== 0) writer.tag(4, runtime_1$8.WireType.Varint).uint32(message.numTimesDismissed);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.RecurringDismissibleContentState
	*/
	exports.PreloadedUserSettings_RecurringDismissibleContentState = new PreloadedUserSettings_RecurringDismissibleContentState$Type();
	var PreloadedUserSettings_UserContentSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.UserContentSettings", [
				{
					no: 1,
					name: "dismissed_contents",
					kind: "scalar",
					T: 12
				},
				{
					no: 2,
					name: "last_dismissed_outbound_promotion_start_date",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 3,
					name: "premium_tier_0_modal_dismissed_at",
					kind: "message",
					T: () => timestamp_1$2.Timestamp
				},
				{
					no: 4,
					name: "guild_onboarding_upsell_dismissed_at",
					kind: "message",
					T: () => timestamp_1$2.Timestamp
				},
				{
					no: 5,
					name: "safety_user_sentiment_notice_dismissed_at",
					kind: "message",
					T: () => timestamp_1$2.Timestamp
				},
				{
					no: 6,
					name: "last_received_changelog_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 7,
					name: "recurring_dismissible_content_states",
					kind: "map",
					K: 5,
					V: {
						kind: "message",
						T: () => exports.PreloadedUserSettings_RecurringDismissibleContentState
					}
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.dismissedContents = new Uint8Array(0);
			message.lastReceivedChangelogId = 0n;
			message.recurringDismissibleContentStates = {};
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.dismissedContents = reader.bytes();
						break;
					case 2:
						message.lastDismissedOutboundPromotionStartDate = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.lastDismissedOutboundPromotionStartDate);
						break;
					case 3:
						message.premiumTier0ModalDismissedAt = timestamp_1$2.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.premiumTier0ModalDismissedAt);
						break;
					case 4:
						message.guildOnboardingUpsellDismissedAt = timestamp_1$2.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.guildOnboardingUpsellDismissedAt);
						break;
					case 5:
						message.safetyUserSentimentNoticeDismissedAt = timestamp_1$2.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.safetyUserSentimentNoticeDismissedAt);
						break;
					case 6:
						message.lastReceivedChangelogId = reader.fixed64().toBigInt();
						break;
					case 7:
						this.binaryReadMap7(message.recurringDismissibleContentStates, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap7(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.int32();
						break;
					case 2:
						val = exports.PreloadedUserSettings_RecurringDismissibleContentState.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.UserContentSettings.recurring_dismissible_content_states");
				}
			}
			map[key ?? 0] = val ?? exports.PreloadedUserSettings_RecurringDismissibleContentState.create();
		}
		internalBinaryWrite(message, writer, options) {
			if (message.dismissedContents.length) writer.tag(1, runtime_1$8.WireType.LengthDelimited).bytes(message.dismissedContents);
			if (message.lastDismissedOutboundPromotionStartDate) wrappers_6.StringValue.internalBinaryWrite(message.lastDismissedOutboundPromotionStartDate, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.premiumTier0ModalDismissedAt) timestamp_1$2.Timestamp.internalBinaryWrite(message.premiumTier0ModalDismissedAt, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.guildOnboardingUpsellDismissedAt) timestamp_1$2.Timestamp.internalBinaryWrite(message.guildOnboardingUpsellDismissedAt, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.safetyUserSentimentNoticeDismissedAt) timestamp_1$2.Timestamp.internalBinaryWrite(message.safetyUserSentimentNoticeDismissedAt, writer.tag(5, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.lastReceivedChangelogId !== 0n) writer.tag(6, runtime_1$8.WireType.Bit64).fixed64(message.lastReceivedChangelogId);
			for (let k of globalThis.Object.keys(message.recurringDismissibleContentStates)) {
				writer.tag(7, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Varint).int32(parseInt(k));
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_RecurringDismissibleContentState.internalBinaryWrite(message.recurringDismissibleContentStates[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.UserContentSettings
	*/
	exports.PreloadedUserSettings_UserContentSettings = new PreloadedUserSettings_UserContentSettings$Type();
	var PreloadedUserSettings_VideoFilterBackgroundBlur$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.VideoFilterBackgroundBlur", [{
				no: 1,
				name: "use_blur",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.useBlur = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.useBlur = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.useBlur !== false) writer.tag(1, runtime_1$8.WireType.Varint).bool(message.useBlur);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.VideoFilterBackgroundBlur
	*/
	exports.PreloadedUserSettings_VideoFilterBackgroundBlur = new PreloadedUserSettings_VideoFilterBackgroundBlur$Type();
	var PreloadedUserSettings_VideoFilterAsset$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.VideoFilterAsset", [{
				no: 1,
				name: "id",
				kind: "scalar",
				T: 6,
				L: 0
			}, {
				no: 2,
				name: "asset_hash",
				kind: "scalar",
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.id = 0n;
			message.assetHash = "";
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.id = reader.fixed64().toBigInt();
						break;
					case 2:
						message.assetHash = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.id !== 0n) writer.tag(1, runtime_1$8.WireType.Bit64).fixed64(message.id);
			if (message.assetHash !== "") writer.tag(2, runtime_1$8.WireType.LengthDelimited).string(message.assetHash);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.VideoFilterAsset
	*/
	exports.PreloadedUserSettings_VideoFilterAsset = new PreloadedUserSettings_VideoFilterAsset$Type();
	var PreloadedUserSettings_SoundboardSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.SoundboardSettings", [{
				no: 1,
				name: "volume",
				kind: "scalar",
				T: 2
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.volume = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.volume = reader.float();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.volume !== 0) writer.tag(1, runtime_1$8.WireType.Bit32).float(message.volume);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.SoundboardSettings
	*/
	exports.PreloadedUserSettings_SoundboardSettings = new PreloadedUserSettings_SoundboardSettings$Type();
	var PreloadedUserSettings_VoiceAndVideoSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.VoiceAndVideoSettings", [
				{
					no: 1,
					name: "blur",
					kind: "message",
					oneof: "videoBackgroundFilterDesktop",
					T: () => exports.PreloadedUserSettings_VideoFilterBackgroundBlur
				},
				{
					no: 2,
					name: "preset_option",
					kind: "scalar",
					oneof: "videoBackgroundFilterDesktop",
					T: 13
				},
				{
					no: 3,
					name: "custom_asset",
					kind: "message",
					oneof: "videoBackgroundFilterDesktop",
					T: () => exports.PreloadedUserSettings_VideoFilterAsset
				},
				{
					no: 5,
					name: "always_preview_video",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 6,
					name: "afk_timeout",
					kind: "message",
					T: () => wrappers_4.UInt32Value
				},
				{
					no: 7,
					name: "stream_notifications_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 8,
					name: "native_phone_integration_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 9,
					name: "soundboard_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_SoundboardSettings
				},
				{
					no: 10,
					name: "disable_stream_previews",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 11,
					name: "soundmoji_volume",
					kind: "message",
					T: () => wrappers_3$1.FloatValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.videoBackgroundFilterDesktop = { oneofKind: undefined };
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.videoBackgroundFilterDesktop = {
							oneofKind: "blur",
							blur: exports.PreloadedUserSettings_VideoFilterBackgroundBlur.internalBinaryRead(reader, reader.uint32(), options, message.videoBackgroundFilterDesktop.blur)
						};
						break;
					case 2:
						message.videoBackgroundFilterDesktop = {
							oneofKind: "presetOption",
							presetOption: reader.uint32()
						};
						break;
					case 3:
						message.videoBackgroundFilterDesktop = {
							oneofKind: "customAsset",
							customAsset: exports.PreloadedUserSettings_VideoFilterAsset.internalBinaryRead(reader, reader.uint32(), options, message.videoBackgroundFilterDesktop.customAsset)
						};
						break;
					case 5:
						message.alwaysPreviewVideo = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.alwaysPreviewVideo);
						break;
					case 6:
						message.afkTimeout = wrappers_4.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.afkTimeout);
						break;
					case 7:
						message.streamNotificationsEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.streamNotificationsEnabled);
						break;
					case 8:
						message.nativePhoneIntegrationEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.nativePhoneIntegrationEnabled);
						break;
					case 9:
						message.soundboardSettings = exports.PreloadedUserSettings_SoundboardSettings.internalBinaryRead(reader, reader.uint32(), options, message.soundboardSettings);
						break;
					case 10:
						message.disableStreamPreviews = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.disableStreamPreviews);
						break;
					case 11:
						message.soundmojiVolume = wrappers_3$1.FloatValue.internalBinaryRead(reader, reader.uint32(), options, message.soundmojiVolume);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.videoBackgroundFilterDesktop.oneofKind === "blur") exports.PreloadedUserSettings_VideoFilterBackgroundBlur.internalBinaryWrite(message.videoBackgroundFilterDesktop.blur, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.videoBackgroundFilterDesktop.oneofKind === "presetOption") writer.tag(2, runtime_1$8.WireType.Varint).uint32(message.videoBackgroundFilterDesktop.presetOption);
			if (message.videoBackgroundFilterDesktop.oneofKind === "customAsset") exports.PreloadedUserSettings_VideoFilterAsset.internalBinaryWrite(message.videoBackgroundFilterDesktop.customAsset, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.alwaysPreviewVideo) wrappers_5.BoolValue.internalBinaryWrite(message.alwaysPreviewVideo, writer.tag(5, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.afkTimeout) wrappers_4.UInt32Value.internalBinaryWrite(message.afkTimeout, writer.tag(6, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.streamNotificationsEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.streamNotificationsEnabled, writer.tag(7, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.nativePhoneIntegrationEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.nativePhoneIntegrationEnabled, writer.tag(8, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.soundboardSettings) exports.PreloadedUserSettings_SoundboardSettings.internalBinaryWrite(message.soundboardSettings, writer.tag(9, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.disableStreamPreviews) wrappers_5.BoolValue.internalBinaryWrite(message.disableStreamPreviews, writer.tag(10, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.soundmojiVolume) wrappers_3$1.FloatValue.internalBinaryWrite(message.soundmojiVolume, writer.tag(11, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.VoiceAndVideoSettings
	*/
	exports.PreloadedUserSettings_VoiceAndVideoSettings = new PreloadedUserSettings_VoiceAndVideoSettings$Type();
	var PreloadedUserSettings_ExplicitContentSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentSettings", [
				{
					no: 1,
					name: "explicit_content_guilds",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				},
				{
					no: 2,
					name: "explicit_content_friend_dm",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				},
				{
					no: 3,
					name: "explicit_content_non_friend_dm",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.explicitContentGuilds = 0;
			message.explicitContentFriendDm = 0;
			message.explicitContentNonFriendDm = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.explicitContentGuilds = reader.int32();
						break;
					case 2:
						message.explicitContentFriendDm = reader.int32();
						break;
					case 3:
						message.explicitContentNonFriendDm = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.explicitContentGuilds !== 0) writer.tag(1, runtime_1$8.WireType.Varint).int32(message.explicitContentGuilds);
			if (message.explicitContentFriendDm !== 0) writer.tag(2, runtime_1$8.WireType.Varint).int32(message.explicitContentFriendDm);
			if (message.explicitContentNonFriendDm !== 0) writer.tag(3, runtime_1$8.WireType.Varint).int32(message.explicitContentNonFriendDm);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentSettings
	*/
	exports.PreloadedUserSettings_ExplicitContentSettings = new PreloadedUserSettings_ExplicitContentSettings$Type();
	var PreloadedUserSettings_KeywordFilterSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.KeywordFilterSettings", [
				{
					no: 1,
					name: "profanity",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 2,
					name: "sexual_content",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 3,
					name: "slurs",
					kind: "message",
					T: () => wrappers_5.BoolValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.profanity = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.profanity);
						break;
					case 2:
						message.sexualContent = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.sexualContent);
						break;
					case 3:
						message.slurs = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.slurs);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.profanity) wrappers_5.BoolValue.internalBinaryWrite(message.profanity, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.sexualContent) wrappers_5.BoolValue.internalBinaryWrite(message.sexualContent, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.slurs) wrappers_5.BoolValue.internalBinaryWrite(message.slurs, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.KeywordFilterSettings
	*/
	exports.PreloadedUserSettings_KeywordFilterSettings = new PreloadedUserSettings_KeywordFilterSettings$Type();
	var PreloadedUserSettings_GoreContentSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.GoreContentSettings", [
				{
					no: 1,
					name: "gore_content_guilds",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				},
				{
					no: 2,
					name: "gore_content_friend_dm",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				},
				{
					no: 3,
					name: "gore_content_non_friend_dm",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.goreContentGuilds = 0;
			message.goreContentFriendDm = 0;
			message.goreContentNonFriendDm = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.goreContentGuilds = reader.int32();
						break;
					case 2:
						message.goreContentFriendDm = reader.int32();
						break;
					case 3:
						message.goreContentNonFriendDm = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.goreContentGuilds !== 0) writer.tag(1, runtime_1$8.WireType.Varint).int32(message.goreContentGuilds);
			if (message.goreContentFriendDm !== 0) writer.tag(2, runtime_1$8.WireType.Varint).int32(message.goreContentFriendDm);
			if (message.goreContentNonFriendDm !== 0) writer.tag(3, runtime_1$8.WireType.Varint).int32(message.goreContentNonFriendDm);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.GoreContentSettings
	*/
	exports.PreloadedUserSettings_GoreContentSettings = new PreloadedUserSettings_GoreContentSettings$Type();
	var PreloadedUserSettings_DefaultReactionEmoji$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.DefaultReactionEmoji", [
				{
					no: 1,
					name: "emoji_id",
					kind: "message",
					T: () => wrappers_7.UInt64Value
				},
				{
					no: 2,
					name: "emoji_name",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 3,
					name: "animated",
					kind: "message",
					T: () => wrappers_5.BoolValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.emojiId = wrappers_7.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.emojiId);
						break;
					case 2:
						message.emojiName = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.emojiName);
						break;
					case 3:
						message.animated = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.animated);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.emojiId) wrappers_7.UInt64Value.internalBinaryWrite(message.emojiId, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.emojiName) wrappers_6.StringValue.internalBinaryWrite(message.emojiName, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.animated) wrappers_5.BoolValue.internalBinaryWrite(message.animated, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.DefaultReactionEmoji
	*/
	exports.PreloadedUserSettings_DefaultReactionEmoji = new PreloadedUserSettings_DefaultReactionEmoji$Type();
	var PreloadedUserSettings_SelfHarmContentSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.SelfHarmContentSettings", [
				{
					no: 1,
					name: "self_harm_content_guilds",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				},
				{
					no: 2,
					name: "self_harm_content_friend_dm",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				},
				{
					no: 3,
					name: "self_harm_content_non_friend_dm",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ExplicitContentRedaction",
						PreloadedUserSettings_ExplicitContentRedaction,
						"EXPLICIT_CONTENT_REDACTION_"
					]
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.selfHarmContentGuilds = 0;
			message.selfHarmContentFriendDm = 0;
			message.selfHarmContentNonFriendDm = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.selfHarmContentGuilds = reader.int32();
						break;
					case 2:
						message.selfHarmContentFriendDm = reader.int32();
						break;
					case 3:
						message.selfHarmContentNonFriendDm = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.selfHarmContentGuilds !== 0) writer.tag(1, runtime_1$8.WireType.Varint).int32(message.selfHarmContentGuilds);
			if (message.selfHarmContentFriendDm !== 0) writer.tag(2, runtime_1$8.WireType.Varint).int32(message.selfHarmContentFriendDm);
			if (message.selfHarmContentNonFriendDm !== 0) writer.tag(3, runtime_1$8.WireType.Varint).int32(message.selfHarmContentNonFriendDm);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.SelfHarmContentSettings
	*/
	exports.PreloadedUserSettings_SelfHarmContentSettings = new PreloadedUserSettings_SelfHarmContentSettings$Type();
	var PreloadedUserSettings_TextAndImagesSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.TextAndImagesSettings", [
				{
					no: 1,
					name: "diversity_surrogate",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 2,
					name: "use_rich_chat_input",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 3,
					name: "use_thread_sidebar",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 4,
					name: "render_spoilers",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 5,
					name: "emoji_picker_collapsed_sections",
					kind: "scalar",
					repeat: 2,
					T: 9
				},
				{
					no: 6,
					name: "sticker_picker_collapsed_sections",
					kind: "scalar",
					repeat: 2,
					T: 9
				},
				{
					no: 7,
					name: "view_image_descriptions",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 8,
					name: "show_command_suggestions",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 9,
					name: "inline_attachment_media",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 10,
					name: "inline_embed_media",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 11,
					name: "gif_auto_play",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 12,
					name: "render_embeds",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 13,
					name: "render_reactions",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 14,
					name: "animate_emoji",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 15,
					name: "animate_stickers",
					kind: "message",
					T: () => wrappers_4.UInt32Value
				},
				{
					no: 16,
					name: "enable_tts_command",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 17,
					name: "message_display_compact",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 19,
					name: "explicit_content_filter",
					kind: "message",
					T: () => wrappers_4.UInt32Value
				},
				{
					no: 20,
					name: "view_nsfw_guilds",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 21,
					name: "convert_emoticons",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 22,
					name: "expression_suggestions_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 23,
					name: "view_nsfw_commands",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 24,
					name: "use_legacy_chat_input",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 25,
					name: "soundboard_picker_collapsed_sections",
					kind: "scalar",
					repeat: 2,
					T: 9
				},
				{
					no: 26,
					name: "dm_spam_filter",
					kind: "message",
					T: () => wrappers_4.UInt32Value
				},
				{
					no: 27,
					name: "dm_spam_filter_v2",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.DmSpamFilterV2",
						PreloadedUserSettings_DmSpamFilterV2,
						"DM_SPAM_FILTER_V2_"
					]
				},
				{
					no: 28,
					name: "include_stickers_in_autocomplete",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 29,
					name: "explicit_content_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_ExplicitContentSettings
				},
				{
					no: 30,
					name: "keyword_filter_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_KeywordFilterSettings
				},
				{
					no: 31,
					name: "include_soundmoji_in_autocomplete",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 32,
					name: "gore_content_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_GoreContentSettings
				},
				{
					no: 33,
					name: "default_reaction_emoji",
					kind: "message",
					T: () => exports.PreloadedUserSettings_DefaultReactionEmoji
				},
				{
					no: 34,
					name: "show_mention_suggestions",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 35,
					name: "self_harm_content_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_SelfHarmContentSettings
				},
				{
					no: 36,
					name: "is_cross_dm_search_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.emojiPickerCollapsedSections = [];
			message.stickerPickerCollapsedSections = [];
			message.soundboardPickerCollapsedSections = [];
			message.dmSpamFilterV2 = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.diversitySurrogate = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.diversitySurrogate);
						break;
					case 2:
						message.useRichChatInput = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.useRichChatInput);
						break;
					case 3:
						message.useThreadSidebar = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.useThreadSidebar);
						break;
					case 4:
						message.renderSpoilers = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.renderSpoilers);
						break;
					case 5:
						message.emojiPickerCollapsedSections.push(reader.string());
						break;
					case 6:
						message.stickerPickerCollapsedSections.push(reader.string());
						break;
					case 7:
						message.viewImageDescriptions = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.viewImageDescriptions);
						break;
					case 8:
						message.showCommandSuggestions = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.showCommandSuggestions);
						break;
					case 9:
						message.inlineAttachmentMedia = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.inlineAttachmentMedia);
						break;
					case 10:
						message.inlineEmbedMedia = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.inlineEmbedMedia);
						break;
					case 11:
						message.gifAutoPlay = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.gifAutoPlay);
						break;
					case 12:
						message.renderEmbeds = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.renderEmbeds);
						break;
					case 13:
						message.renderReactions = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.renderReactions);
						break;
					case 14:
						message.animateEmoji = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.animateEmoji);
						break;
					case 15:
						message.animateStickers = wrappers_4.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.animateStickers);
						break;
					case 16:
						message.enableTtsCommand = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.enableTtsCommand);
						break;
					case 17:
						message.messageDisplayCompact = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.messageDisplayCompact);
						break;
					case 19:
						message.explicitContentFilter = wrappers_4.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.explicitContentFilter);
						break;
					case 20:
						message.viewNsfwGuilds = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.viewNsfwGuilds);
						break;
					case 21:
						message.convertEmoticons = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.convertEmoticons);
						break;
					case 22:
						message.expressionSuggestionsEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.expressionSuggestionsEnabled);
						break;
					case 23:
						message.viewNsfwCommands = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.viewNsfwCommands);
						break;
					case 24:
						message.useLegacyChatInput = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.useLegacyChatInput);
						break;
					case 25:
						message.soundboardPickerCollapsedSections.push(reader.string());
						break;
					case 26:
						message.dmSpamFilter = wrappers_4.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.dmSpamFilter);
						break;
					case 27:
						message.dmSpamFilterV2 = reader.int32();
						break;
					case 28:
						message.includeStickersInAutocomplete = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.includeStickersInAutocomplete);
						break;
					case 29:
						message.explicitContentSettings = exports.PreloadedUserSettings_ExplicitContentSettings.internalBinaryRead(reader, reader.uint32(), options, message.explicitContentSettings);
						break;
					case 30:
						message.keywordFilterSettings = exports.PreloadedUserSettings_KeywordFilterSettings.internalBinaryRead(reader, reader.uint32(), options, message.keywordFilterSettings);
						break;
					case 31:
						message.includeSoundmojiInAutocomplete = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.includeSoundmojiInAutocomplete);
						break;
					case 32:
						message.goreContentSettings = exports.PreloadedUserSettings_GoreContentSettings.internalBinaryRead(reader, reader.uint32(), options, message.goreContentSettings);
						break;
					case 33:
						message.defaultReactionEmoji = exports.PreloadedUserSettings_DefaultReactionEmoji.internalBinaryRead(reader, reader.uint32(), options, message.defaultReactionEmoji);
						break;
					case 34:
						message.showMentionSuggestions = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.showMentionSuggestions);
						break;
					case 35:
						message.selfHarmContentSettings = exports.PreloadedUserSettings_SelfHarmContentSettings.internalBinaryRead(reader, reader.uint32(), options, message.selfHarmContentSettings);
						break;
					case 36:
						message.isCrossDmSearchEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.isCrossDmSearchEnabled);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.diversitySurrogate) wrappers_6.StringValue.internalBinaryWrite(message.diversitySurrogate, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.useRichChatInput) wrappers_5.BoolValue.internalBinaryWrite(message.useRichChatInput, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.useThreadSidebar) wrappers_5.BoolValue.internalBinaryWrite(message.useThreadSidebar, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.renderSpoilers) wrappers_6.StringValue.internalBinaryWrite(message.renderSpoilers, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			for (let i = 0; i < message.emojiPickerCollapsedSections.length; i++) writer.tag(5, runtime_1$8.WireType.LengthDelimited).string(message.emojiPickerCollapsedSections[i]);
			for (let i = 0; i < message.stickerPickerCollapsedSections.length; i++) writer.tag(6, runtime_1$8.WireType.LengthDelimited).string(message.stickerPickerCollapsedSections[i]);
			if (message.viewImageDescriptions) wrappers_5.BoolValue.internalBinaryWrite(message.viewImageDescriptions, writer.tag(7, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.showCommandSuggestions) wrappers_5.BoolValue.internalBinaryWrite(message.showCommandSuggestions, writer.tag(8, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.inlineAttachmentMedia) wrappers_5.BoolValue.internalBinaryWrite(message.inlineAttachmentMedia, writer.tag(9, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.inlineEmbedMedia) wrappers_5.BoolValue.internalBinaryWrite(message.inlineEmbedMedia, writer.tag(10, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.gifAutoPlay) wrappers_5.BoolValue.internalBinaryWrite(message.gifAutoPlay, writer.tag(11, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.renderEmbeds) wrappers_5.BoolValue.internalBinaryWrite(message.renderEmbeds, writer.tag(12, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.renderReactions) wrappers_5.BoolValue.internalBinaryWrite(message.renderReactions, writer.tag(13, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.animateEmoji) wrappers_5.BoolValue.internalBinaryWrite(message.animateEmoji, writer.tag(14, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.animateStickers) wrappers_4.UInt32Value.internalBinaryWrite(message.animateStickers, writer.tag(15, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.enableTtsCommand) wrappers_5.BoolValue.internalBinaryWrite(message.enableTtsCommand, writer.tag(16, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.messageDisplayCompact) wrappers_5.BoolValue.internalBinaryWrite(message.messageDisplayCompact, writer.tag(17, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.explicitContentFilter) wrappers_4.UInt32Value.internalBinaryWrite(message.explicitContentFilter, writer.tag(19, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.viewNsfwGuilds) wrappers_5.BoolValue.internalBinaryWrite(message.viewNsfwGuilds, writer.tag(20, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.convertEmoticons) wrappers_5.BoolValue.internalBinaryWrite(message.convertEmoticons, writer.tag(21, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.expressionSuggestionsEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.expressionSuggestionsEnabled, writer.tag(22, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.viewNsfwCommands) wrappers_5.BoolValue.internalBinaryWrite(message.viewNsfwCommands, writer.tag(23, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.useLegacyChatInput) wrappers_5.BoolValue.internalBinaryWrite(message.useLegacyChatInput, writer.tag(24, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			for (let i = 0; i < message.soundboardPickerCollapsedSections.length; i++) writer.tag(25, runtime_1$8.WireType.LengthDelimited).string(message.soundboardPickerCollapsedSections[i]);
			if (message.dmSpamFilter) wrappers_4.UInt32Value.internalBinaryWrite(message.dmSpamFilter, writer.tag(26, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.dmSpamFilterV2 !== 0) writer.tag(27, runtime_1$8.WireType.Varint).int32(message.dmSpamFilterV2);
			if (message.includeStickersInAutocomplete) wrappers_5.BoolValue.internalBinaryWrite(message.includeStickersInAutocomplete, writer.tag(28, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.explicitContentSettings) exports.PreloadedUserSettings_ExplicitContentSettings.internalBinaryWrite(message.explicitContentSettings, writer.tag(29, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.keywordFilterSettings) exports.PreloadedUserSettings_KeywordFilterSettings.internalBinaryWrite(message.keywordFilterSettings, writer.tag(30, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.includeSoundmojiInAutocomplete) wrappers_5.BoolValue.internalBinaryWrite(message.includeSoundmojiInAutocomplete, writer.tag(31, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.goreContentSettings) exports.PreloadedUserSettings_GoreContentSettings.internalBinaryWrite(message.goreContentSettings, writer.tag(32, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.defaultReactionEmoji) exports.PreloadedUserSettings_DefaultReactionEmoji.internalBinaryWrite(message.defaultReactionEmoji, writer.tag(33, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.showMentionSuggestions) wrappers_5.BoolValue.internalBinaryWrite(message.showMentionSuggestions, writer.tag(34, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.selfHarmContentSettings) exports.PreloadedUserSettings_SelfHarmContentSettings.internalBinaryWrite(message.selfHarmContentSettings, writer.tag(35, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.isCrossDmSearchEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.isCrossDmSearchEnabled, writer.tag(36, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.TextAndImagesSettings
	*/
	exports.PreloadedUserSettings_TextAndImagesSettings = new PreloadedUserSettings_TextAndImagesSettings$Type();
	var PreloadedUserSettings_NotificationSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.NotificationSettings", [
				{
					no: 1,
					name: "show_in_app_notifications",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 2,
					name: "notify_friends_on_go_live",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 3,
					name: "notification_center_acked_before_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 4,
					name: "enable_burst_reaction_notifications",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 5,
					name: "quiet_mode",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 6,
					name: "focus_mode_expires_at_ms",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 7,
					name: "reaction_notifications",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.ReactionNotificationType",
						PreloadedUserSettings_ReactionNotificationType,
						"REACTION_NOTIFICATION_TYPE_"
					]
				},
				{
					no: 8,
					name: "game_activity_notifications",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.GameActivityNotificationType",
						PreloadedUserSettings_GameActivityNotificationType,
						"GAME_ACTIVITY_NOTIFICATION_TYPE_"
					]
				},
				{
					no: 9,
					name: "custom_status_push_notifications",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.CustomStatusPushNotificationType",
						PreloadedUserSettings_CustomStatusPushNotificationType,
						"CUSTOM_STATUS_PUSH_NOTIFICATION_TYPE_"
					]
				},
				{
					no: 10,
					name: "game_activity_exclude_steam_notifications",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 11,
					name: "enable_voice_activity_notifications",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 12,
					name: "enable_friend_online_notifications",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 13,
					name: "enable_user_resurrection_notifications",
					kind: "message",
					T: () => wrappers_5.BoolValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.notificationCenterAckedBeforeId = 0n;
			message.focusModeExpiresAtMs = 0n;
			message.reactionNotifications = 0;
			message.gameActivityNotifications = 0;
			message.customStatusPushNotifications = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.showInAppNotifications = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.showInAppNotifications);
						break;
					case 2:
						message.notifyFriendsOnGoLive = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.notifyFriendsOnGoLive);
						break;
					case 3:
						message.notificationCenterAckedBeforeId = reader.fixed64().toBigInt();
						break;
					case 4:
						message.enableBurstReactionNotifications = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.enableBurstReactionNotifications);
						break;
					case 5:
						message.quietMode = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.quietMode);
						break;
					case 6:
						message.focusModeExpiresAtMs = reader.fixed64().toBigInt();
						break;
					case 7:
						message.reactionNotifications = reader.int32();
						break;
					case 8:
						message.gameActivityNotifications = reader.int32();
						break;
					case 9:
						message.customStatusPushNotifications = reader.int32();
						break;
					case 10:
						message.gameActivityExcludeSteamNotifications = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.gameActivityExcludeSteamNotifications);
						break;
					case 11:
						message.enableVoiceActivityNotifications = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.enableVoiceActivityNotifications);
						break;
					case 12:
						message.enableFriendOnlineNotifications = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.enableFriendOnlineNotifications);
						break;
					case 13:
						message.enableUserResurrectionNotifications = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.enableUserResurrectionNotifications);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.showInAppNotifications) wrappers_5.BoolValue.internalBinaryWrite(message.showInAppNotifications, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.notifyFriendsOnGoLive) wrappers_5.BoolValue.internalBinaryWrite(message.notifyFriendsOnGoLive, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.notificationCenterAckedBeforeId !== 0n) writer.tag(3, runtime_1$8.WireType.Bit64).fixed64(message.notificationCenterAckedBeforeId);
			if (message.enableBurstReactionNotifications) wrappers_5.BoolValue.internalBinaryWrite(message.enableBurstReactionNotifications, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.quietMode) wrappers_5.BoolValue.internalBinaryWrite(message.quietMode, writer.tag(5, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.focusModeExpiresAtMs !== 0n) writer.tag(6, runtime_1$8.WireType.Bit64).fixed64(message.focusModeExpiresAtMs);
			if (message.reactionNotifications !== 0) writer.tag(7, runtime_1$8.WireType.Varint).int32(message.reactionNotifications);
			if (message.gameActivityNotifications !== 0) writer.tag(8, runtime_1$8.WireType.Varint).int32(message.gameActivityNotifications);
			if (message.customStatusPushNotifications !== 0) writer.tag(9, runtime_1$8.WireType.Varint).int32(message.customStatusPushNotifications);
			if (message.gameActivityExcludeSteamNotifications) wrappers_5.BoolValue.internalBinaryWrite(message.gameActivityExcludeSteamNotifications, writer.tag(10, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.enableVoiceActivityNotifications) wrappers_5.BoolValue.internalBinaryWrite(message.enableVoiceActivityNotifications, writer.tag(11, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.enableFriendOnlineNotifications) wrappers_5.BoolValue.internalBinaryWrite(message.enableFriendOnlineNotifications, writer.tag(12, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.enableUserResurrectionNotifications) wrappers_5.BoolValue.internalBinaryWrite(message.enableUserResurrectionNotifications, writer.tag(13, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.NotificationSettings
	*/
	exports.PreloadedUserSettings_NotificationSettings = new PreloadedUserSettings_NotificationSettings$Type();
	var PreloadedUserSettings_PrivacySettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.PrivacySettings", [
				{
					no: 1,
					name: "allow_activity_party_privacy_friends",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 2,
					name: "allow_activity_party_privacy_voice_channel",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 3,
					name: "restricted_guild_ids",
					kind: "scalar",
					repeat: 1,
					T: 6,
					L: 0
				},
				{
					no: 4,
					name: "default_guilds_restricted",
					kind: "scalar",
					T: 8
				},
				{
					no: 7,
					name: "allow_accessibility_detection",
					kind: "scalar",
					T: 8
				},
				{
					no: 8,
					name: "detect_platform_accounts",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 9,
					name: "passwordless",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 10,
					name: "contact_sync_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 11,
					name: "friend_source_flags",
					kind: "message",
					T: () => wrappers_4.UInt32Value
				},
				{
					no: 12,
					name: "friend_discovery_flags",
					kind: "message",
					T: () => wrappers_4.UInt32Value
				},
				{
					no: 13,
					name: "activity_restricted_guild_ids",
					kind: "scalar",
					repeat: 1,
					T: 6,
					L: 0
				},
				{
					no: 14,
					name: "default_guilds_activity_restricted",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.GuildActivityStatusRestrictionDefault",
						PreloadedUserSettings_GuildActivityStatusRestrictionDefault,
						"GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_"
					]
				},
				{
					no: 15,
					name: "activity_joining_restricted_guild_ids",
					kind: "scalar",
					repeat: 1,
					T: 6,
					L: 0
				},
				{
					no: 16,
					name: "message_request_restricted_guild_ids",
					kind: "scalar",
					repeat: 1,
					T: 6,
					L: 0
				},
				{
					no: 17,
					name: "default_message_request_restricted",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 18,
					name: "drops_opted_out",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 19,
					name: "non_spam_retraining_opt_in",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 20,
					name: "family_center_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 21,
					name: "family_center_enabled_v2",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 22,
					name: "hide_legacy_username",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 23,
					name: "inappropriate_conversation_warnings",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 24,
					name: "recent_games_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 25,
					name: "guilds_leaderboard_opt_out_default",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.GuildsLeaderboardOptOutDefault",
						PreloadedUserSettings_GuildsLeaderboardOptOutDefault,
						"GUILDS_LEADERBOARD_OPT_OUT_DEFAULT_"
					]
				},
				{
					no: 26,
					name: "allow_game_friend_dms_in_discord",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 27,
					name: "default_guilds_restricted_v2",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 28,
					name: "slayer_sdk_receive_dms_in_game",
					kind: "enum",
					T: () => ["discord_protos.discord_users.v1.PreloadedUserSettings.SlayerSDKReceiveInGameDMs", PreloadedUserSettings_SlayerSDKReceiveInGameDMs]
				},
				{
					no: 29,
					name: "default_guilds_activity_restricted_v2",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.GuildActivityStatusRestrictionDefaultV2",
						PreloadedUserSettings_GuildActivityStatusRestrictionDefaultV2,
						"GUILD_ACTIVITY_STATUS_RESTRICTION_DEFAULT_V2_"
					]
				},
				{
					no: 30,
					name: "quests_3p_data_opted_out",
					kind: "message",
					jsonName: "quests3pDataOptedOut",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 31,
					name: "show_local_time",
					kind: "message",
					T: () => wrappers_5.BoolValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.restrictedGuildIds = [];
			message.defaultGuildsRestricted = false;
			message.allowAccessibilityDetection = false;
			message.activityRestrictedGuildIds = [];
			message.defaultGuildsActivityRestricted = 0;
			message.activityJoiningRestrictedGuildIds = [];
			message.messageRequestRestrictedGuildIds = [];
			message.guildsLeaderboardOptOutDefault = 0;
			message.slayerSdkReceiveDmsInGame = 0;
			message.defaultGuildsActivityRestrictedV2 = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.allowActivityPartyPrivacyFriends = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.allowActivityPartyPrivacyFriends);
						break;
					case 2:
						message.allowActivityPartyPrivacyVoiceChannel = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.allowActivityPartyPrivacyVoiceChannel);
						break;
					case 3:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.restrictedGuildIds.push(reader.fixed64().toBigInt());
else message.restrictedGuildIds.push(reader.fixed64().toBigInt());
						break;
					case 4:
						message.defaultGuildsRestricted = reader.bool();
						break;
					case 7:
						message.allowAccessibilityDetection = reader.bool();
						break;
					case 8:
						message.detectPlatformAccounts = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.detectPlatformAccounts);
						break;
					case 9:
						message.passwordless = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.passwordless);
						break;
					case 10:
						message.contactSyncEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.contactSyncEnabled);
						break;
					case 11:
						message.friendSourceFlags = wrappers_4.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.friendSourceFlags);
						break;
					case 12:
						message.friendDiscoveryFlags = wrappers_4.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.friendDiscoveryFlags);
						break;
					case 13:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.activityRestrictedGuildIds.push(reader.fixed64().toBigInt());
else message.activityRestrictedGuildIds.push(reader.fixed64().toBigInt());
						break;
					case 14:
						message.defaultGuildsActivityRestricted = reader.int32();
						break;
					case 15:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.activityJoiningRestrictedGuildIds.push(reader.fixed64().toBigInt());
else message.activityJoiningRestrictedGuildIds.push(reader.fixed64().toBigInt());
						break;
					case 16:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.messageRequestRestrictedGuildIds.push(reader.fixed64().toBigInt());
else message.messageRequestRestrictedGuildIds.push(reader.fixed64().toBigInt());
						break;
					case 17:
						message.defaultMessageRequestRestricted = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.defaultMessageRequestRestricted);
						break;
					case 18:
						message.dropsOptedOut = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.dropsOptedOut);
						break;
					case 19:
						message.nonSpamRetrainingOptIn = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.nonSpamRetrainingOptIn);
						break;
					case 20:
						message.familyCenterEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.familyCenterEnabled);
						break;
					case 21:
						message.familyCenterEnabledV2 = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.familyCenterEnabledV2);
						break;
					case 22:
						message.hideLegacyUsername = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.hideLegacyUsername);
						break;
					case 23:
						message.inappropriateConversationWarnings = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.inappropriateConversationWarnings);
						break;
					case 24:
						message.recentGamesEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.recentGamesEnabled);
						break;
					case 25:
						message.guildsLeaderboardOptOutDefault = reader.int32();
						break;
					case 26:
						message.allowGameFriendDmsInDiscord = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.allowGameFriendDmsInDiscord);
						break;
					case 27:
						message.defaultGuildsRestrictedV2 = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.defaultGuildsRestrictedV2);
						break;
					case 28:
						message.slayerSdkReceiveDmsInGame = reader.int32();
						break;
					case 29:
						message.defaultGuildsActivityRestrictedV2 = reader.int32();
						break;
					case 30:
						message.quests3PDataOptedOut = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.quests3PDataOptedOut);
						break;
					case 31:
						message.showLocalTime = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.showLocalTime);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.allowActivityPartyPrivacyFriends) wrappers_5.BoolValue.internalBinaryWrite(message.allowActivityPartyPrivacyFriends, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.allowActivityPartyPrivacyVoiceChannel) wrappers_5.BoolValue.internalBinaryWrite(message.allowActivityPartyPrivacyVoiceChannel, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.restrictedGuildIds.length) {
				writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.restrictedGuildIds.length; i++) writer.fixed64(message.restrictedGuildIds[i]);
				writer.join();
			}
			if (message.defaultGuildsRestricted !== false) writer.tag(4, runtime_1$8.WireType.Varint).bool(message.defaultGuildsRestricted);
			if (message.allowAccessibilityDetection !== false) writer.tag(7, runtime_1$8.WireType.Varint).bool(message.allowAccessibilityDetection);
			if (message.detectPlatformAccounts) wrappers_5.BoolValue.internalBinaryWrite(message.detectPlatformAccounts, writer.tag(8, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.passwordless) wrappers_5.BoolValue.internalBinaryWrite(message.passwordless, writer.tag(9, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.contactSyncEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.contactSyncEnabled, writer.tag(10, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.friendSourceFlags) wrappers_4.UInt32Value.internalBinaryWrite(message.friendSourceFlags, writer.tag(11, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.friendDiscoveryFlags) wrappers_4.UInt32Value.internalBinaryWrite(message.friendDiscoveryFlags, writer.tag(12, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.activityRestrictedGuildIds.length) {
				writer.tag(13, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.activityRestrictedGuildIds.length; i++) writer.fixed64(message.activityRestrictedGuildIds[i]);
				writer.join();
			}
			if (message.defaultGuildsActivityRestricted !== 0) writer.tag(14, runtime_1$8.WireType.Varint).int32(message.defaultGuildsActivityRestricted);
			if (message.activityJoiningRestrictedGuildIds.length) {
				writer.tag(15, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.activityJoiningRestrictedGuildIds.length; i++) writer.fixed64(message.activityJoiningRestrictedGuildIds[i]);
				writer.join();
			}
			if (message.messageRequestRestrictedGuildIds.length) {
				writer.tag(16, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.messageRequestRestrictedGuildIds.length; i++) writer.fixed64(message.messageRequestRestrictedGuildIds[i]);
				writer.join();
			}
			if (message.defaultMessageRequestRestricted) wrappers_5.BoolValue.internalBinaryWrite(message.defaultMessageRequestRestricted, writer.tag(17, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.dropsOptedOut) wrappers_5.BoolValue.internalBinaryWrite(message.dropsOptedOut, writer.tag(18, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.nonSpamRetrainingOptIn) wrappers_5.BoolValue.internalBinaryWrite(message.nonSpamRetrainingOptIn, writer.tag(19, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.familyCenterEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.familyCenterEnabled, writer.tag(20, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.familyCenterEnabledV2) wrappers_5.BoolValue.internalBinaryWrite(message.familyCenterEnabledV2, writer.tag(21, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.hideLegacyUsername) wrappers_5.BoolValue.internalBinaryWrite(message.hideLegacyUsername, writer.tag(22, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.inappropriateConversationWarnings) wrappers_5.BoolValue.internalBinaryWrite(message.inappropriateConversationWarnings, writer.tag(23, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.recentGamesEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.recentGamesEnabled, writer.tag(24, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.guildsLeaderboardOptOutDefault !== 0) writer.tag(25, runtime_1$8.WireType.Varint).int32(message.guildsLeaderboardOptOutDefault);
			if (message.allowGameFriendDmsInDiscord) wrappers_5.BoolValue.internalBinaryWrite(message.allowGameFriendDmsInDiscord, writer.tag(26, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.defaultGuildsRestrictedV2) wrappers_5.BoolValue.internalBinaryWrite(message.defaultGuildsRestrictedV2, writer.tag(27, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.slayerSdkReceiveDmsInGame !== 0) writer.tag(28, runtime_1$8.WireType.Varint).int32(message.slayerSdkReceiveDmsInGame);
			if (message.defaultGuildsActivityRestrictedV2 !== 0) writer.tag(29, runtime_1$8.WireType.Varint).int32(message.defaultGuildsActivityRestrictedV2);
			if (message.quests3PDataOptedOut) wrappers_5.BoolValue.internalBinaryWrite(message.quests3PDataOptedOut, writer.tag(30, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.showLocalTime) wrappers_5.BoolValue.internalBinaryWrite(message.showLocalTime, writer.tag(31, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.PrivacySettings
	*/
	exports.PreloadedUserSettings_PrivacySettings = new PreloadedUserSettings_PrivacySettings$Type();
	var PreloadedUserSettings_DebugSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.DebugSettings", [{
				no: 1,
				name: "rtc_panel_show_voice_states",
				kind: "message",
				T: () => wrappers_5.BoolValue
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.rtcPanelShowVoiceStates = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.rtcPanelShowVoiceStates);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.rtcPanelShowVoiceStates) wrappers_5.BoolValue.internalBinaryWrite(message.rtcPanelShowVoiceStates, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.DebugSettings
	*/
	exports.PreloadedUserSettings_DebugSettings = new PreloadedUserSettings_DebugSettings$Type();
	var PreloadedUserSettings_GameLibrarySettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.GameLibrarySettings", [
				{
					no: 1,
					name: "install_shortcut_desktop",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 2,
					name: "install_shortcut_start_menu",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 3,
					name: "disable_games_tab",
					kind: "message",
					T: () => wrappers_5.BoolValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.installShortcutDesktop = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.installShortcutDesktop);
						break;
					case 2:
						message.installShortcutStartMenu = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.installShortcutStartMenu);
						break;
					case 3:
						message.disableGamesTab = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.disableGamesTab);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.installShortcutDesktop) wrappers_5.BoolValue.internalBinaryWrite(message.installShortcutDesktop, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.installShortcutStartMenu) wrappers_5.BoolValue.internalBinaryWrite(message.installShortcutStartMenu, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.disableGamesTab) wrappers_5.BoolValue.internalBinaryWrite(message.disableGamesTab, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.GameLibrarySettings
	*/
	exports.PreloadedUserSettings_GameLibrarySettings = new PreloadedUserSettings_GameLibrarySettings$Type();
	var PreloadedUserSettings_CustomStatus$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.CustomStatus", [
				{
					no: 1,
					name: "text",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "emoji_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 3,
					name: "emoji_name",
					kind: "scalar",
					T: 9
				},
				{
					no: 4,
					name: "expires_at_ms",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 5,
					name: "created_at_ms",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 6,
					name: "label",
					kind: "message",
					T: () => wrappers_6.StringValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.text = "";
			message.emojiId = 0n;
			message.emojiName = "";
			message.expiresAtMs = 0n;
			message.createdAtMs = 0n;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.text = reader.string();
						break;
					case 2:
						message.emojiId = reader.fixed64().toBigInt();
						break;
					case 3:
						message.emojiName = reader.string();
						break;
					case 4:
						message.expiresAtMs = reader.fixed64().toBigInt();
						break;
					case 5:
						message.createdAtMs = reader.fixed64().toBigInt();
						break;
					case 6:
						message.label = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.label);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.text !== "") writer.tag(1, runtime_1$8.WireType.LengthDelimited).string(message.text);
			if (message.emojiId !== 0n) writer.tag(2, runtime_1$8.WireType.Bit64).fixed64(message.emojiId);
			if (message.emojiName !== "") writer.tag(3, runtime_1$8.WireType.LengthDelimited).string(message.emojiName);
			if (message.expiresAtMs !== 0n) writer.tag(4, runtime_1$8.WireType.Bit64).fixed64(message.expiresAtMs);
			if (message.createdAtMs !== 0n) writer.tag(5, runtime_1$8.WireType.Bit64).fixed64(message.createdAtMs);
			if (message.label) wrappers_6.StringValue.internalBinaryWrite(message.label, writer.tag(6, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.CustomStatus
	*/
	exports.PreloadedUserSettings_CustomStatus = new PreloadedUserSettings_CustomStatus$Type();
	var PreloadedUserSettings_StatusSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.StatusSettings", [
				{
					no: 1,
					name: "status",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 2,
					name: "custom_status",
					kind: "message",
					T: () => exports.PreloadedUserSettings_CustomStatus
				},
				{
					no: 3,
					name: "show_current_game",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 4,
					name: "status_expires_at_ms",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 5,
					name: "status_created_at_ms",
					kind: "message",
					T: () => wrappers_7.UInt64Value
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.statusExpiresAtMs = 0n;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.status = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.status);
						break;
					case 2:
						message.customStatus = exports.PreloadedUserSettings_CustomStatus.internalBinaryRead(reader, reader.uint32(), options, message.customStatus);
						break;
					case 3:
						message.showCurrentGame = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.showCurrentGame);
						break;
					case 4:
						message.statusExpiresAtMs = reader.fixed64().toBigInt();
						break;
					case 5:
						message.statusCreatedAtMs = wrappers_7.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.statusCreatedAtMs);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.status) wrappers_6.StringValue.internalBinaryWrite(message.status, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.customStatus) exports.PreloadedUserSettings_CustomStatus.internalBinaryWrite(message.customStatus, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.showCurrentGame) wrappers_5.BoolValue.internalBinaryWrite(message.showCurrentGame, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.statusExpiresAtMs !== 0n) writer.tag(4, runtime_1$8.WireType.Bit64).fixed64(message.statusExpiresAtMs);
			if (message.statusCreatedAtMs) wrappers_7.UInt64Value.internalBinaryWrite(message.statusCreatedAtMs, writer.tag(5, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.StatusSettings
	*/
	exports.PreloadedUserSettings_StatusSettings = new PreloadedUserSettings_StatusSettings$Type();
	var PreloadedUserSettings_LocalizationSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.LocalizationSettings", [
				{
					no: 1,
					name: "locale",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 2,
					name: "timezone_offset",
					kind: "message",
					T: () => wrappers_2$1.Int32Value
				},
				{
					no: 3,
					name: "timezone_name",
					kind: "message",
					T: () => wrappers_6.StringValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.locale = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.locale);
						break;
					case 2:
						message.timezoneOffset = wrappers_2$1.Int32Value.internalBinaryRead(reader, reader.uint32(), options, message.timezoneOffset);
						break;
					case 3:
						message.timezoneName = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.timezoneName);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.locale) wrappers_6.StringValue.internalBinaryWrite(message.locale, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.timezoneOffset) wrappers_2$1.Int32Value.internalBinaryWrite(message.timezoneOffset, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.timezoneName) wrappers_6.StringValue.internalBinaryWrite(message.timezoneName, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.LocalizationSettings
	*/
	exports.PreloadedUserSettings_LocalizationSettings = new PreloadedUserSettings_LocalizationSettings$Type();
	var PreloadedUserSettings_CustomUserThemeSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.CustomUserThemeSettings", [
				{
					no: 1,
					name: "colors",
					kind: "scalar",
					repeat: 2,
					T: 9
				},
				{
					no: 2,
					name: "gradient_color_stops",
					kind: "scalar",
					repeat: 1,
					T: 2
				},
				{
					no: 3,
					name: "gradient_angle",
					kind: "scalar",
					T: 5
				},
				{
					no: 4,
					name: "base_mix",
					kind: "scalar",
					T: 5
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.colors = [];
			message.gradientColorStops = [];
			message.gradientAngle = 0;
			message.baseMix = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.colors.push(reader.string());
						break;
					case 2:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.gradientColorStops.push(reader.float());
else message.gradientColorStops.push(reader.float());
						break;
					case 3:
						message.gradientAngle = reader.int32();
						break;
					case 4:
						message.baseMix = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.colors.length; i++) writer.tag(1, runtime_1$8.WireType.LengthDelimited).string(message.colors[i]);
			if (message.gradientColorStops.length) {
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.gradientColorStops.length; i++) writer.float(message.gradientColorStops[i]);
				writer.join();
			}
			if (message.gradientAngle !== 0) writer.tag(3, runtime_1$8.WireType.Varint).int32(message.gradientAngle);
			if (message.baseMix !== 0) writer.tag(4, runtime_1$8.WireType.Varint).int32(message.baseMix);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.CustomUserThemeSettings
	*/
	exports.PreloadedUserSettings_CustomUserThemeSettings = new PreloadedUserSettings_CustomUserThemeSettings$Type();
	var PreloadedUserSettings_ClientThemeSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ClientThemeSettings", [{
				no: 2,
				name: "background_gradient_preset_id",
				kind: "message",
				T: () => wrappers_4.UInt32Value
			}, {
				no: 4,
				name: "custom_user_theme_settings",
				kind: "message",
				T: () => exports.PreloadedUserSettings_CustomUserThemeSettings
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 2:
						message.backgroundGradientPresetId = wrappers_4.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.backgroundGradientPresetId);
						break;
					case 4:
						message.customUserThemeSettings = exports.PreloadedUserSettings_CustomUserThemeSettings.internalBinaryRead(reader, reader.uint32(), options, message.customUserThemeSettings);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.backgroundGradientPresetId) wrappers_4.UInt32Value.internalBinaryWrite(message.backgroundGradientPresetId, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.customUserThemeSettings) exports.PreloadedUserSettings_CustomUserThemeSettings.internalBinaryWrite(message.customUserThemeSettings, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ClientThemeSettings
	*/
	exports.PreloadedUserSettings_ClientThemeSettings = new PreloadedUserSettings_ClientThemeSettings$Type();
	var PreloadedUserSettings_AppearanceSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.AppearanceSettings", [
				{
					no: 1,
					name: "theme",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.Theme",
						PreloadedUserSettings_Theme,
						"THEME_"
					]
				},
				{
					no: 2,
					name: "developer_mode",
					kind: "scalar",
					T: 8
				},
				{
					no: 3,
					name: "client_theme_settings",
					kind: "message",
					T: () => exports.PreloadedUserSettings_ClientThemeSettings
				},
				{
					no: 4,
					name: "mobile_redesign_disabled",
					kind: "scalar",
					T: 8
				},
				{
					no: 6,
					name: "channel_list_layout",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 7,
					name: "message_previews",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 8,
					name: "search_result_exact_count_enabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 9,
					name: "timestamp_hour_cycle",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.TimestampHourCycle",
						PreloadedUserSettings_TimestampHourCycle,
						"TIMESTAMP_HOUR_CYCLE_"
					]
				},
				{
					no: 10,
					name: "happening_now_cards_disabled",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 11,
					name: "launch_pad_mode",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.LaunchPadMode",
						PreloadedUserSettings_LaunchPadMode,
						"LAUNCH_PAD_MODE_"
					]
				},
				{
					no: 12,
					name: "ui_density",
					kind: "enum",
					T: () => ["discord_protos.discord_users.v1.PreloadedUserSettings.UIDensity", PreloadedUserSettings_UIDensity]
				},
				{
					no: 13,
					name: "swipe_right_to_left_mode",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.SwipeRightToLeftMode",
						PreloadedUserSettings_SwipeRightToLeftMode,
						"SWIPE_RIGHT_TO_LEFT_MODE_"
					]
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.theme = 0;
			message.developerMode = false;
			message.mobileRedesignDisabled = false;
			message.timestampHourCycle = 0;
			message.launchPadMode = 0;
			message.uiDensity = 0;
			message.swipeRightToLeftMode = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.theme = reader.int32();
						break;
					case 2:
						message.developerMode = reader.bool();
						break;
					case 3:
						message.clientThemeSettings = exports.PreloadedUserSettings_ClientThemeSettings.internalBinaryRead(reader, reader.uint32(), options, message.clientThemeSettings);
						break;
					case 4:
						message.mobileRedesignDisabled = reader.bool();
						break;
					case 6:
						message.channelListLayout = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.channelListLayout);
						break;
					case 7:
						message.messagePreviews = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.messagePreviews);
						break;
					case 8:
						message.searchResultExactCountEnabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.searchResultExactCountEnabled);
						break;
					case 9:
						message.timestampHourCycle = reader.int32();
						break;
					case 10:
						message.happeningNowCardsDisabled = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.happeningNowCardsDisabled);
						break;
					case 11:
						message.launchPadMode = reader.int32();
						break;
					case 12:
						message.uiDensity = reader.int32();
						break;
					case 13:
						message.swipeRightToLeftMode = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.theme !== 0) writer.tag(1, runtime_1$8.WireType.Varint).int32(message.theme);
			if (message.developerMode !== false) writer.tag(2, runtime_1$8.WireType.Varint).bool(message.developerMode);
			if (message.clientThemeSettings) exports.PreloadedUserSettings_ClientThemeSettings.internalBinaryWrite(message.clientThemeSettings, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.mobileRedesignDisabled !== false) writer.tag(4, runtime_1$8.WireType.Varint).bool(message.mobileRedesignDisabled);
			if (message.channelListLayout) wrappers_6.StringValue.internalBinaryWrite(message.channelListLayout, writer.tag(6, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.messagePreviews) wrappers_6.StringValue.internalBinaryWrite(message.messagePreviews, writer.tag(7, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.searchResultExactCountEnabled) wrappers_5.BoolValue.internalBinaryWrite(message.searchResultExactCountEnabled, writer.tag(8, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.timestampHourCycle !== 0) writer.tag(9, runtime_1$8.WireType.Varint).int32(message.timestampHourCycle);
			if (message.happeningNowCardsDisabled) wrappers_5.BoolValue.internalBinaryWrite(message.happeningNowCardsDisabled, writer.tag(10, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.launchPadMode !== 0) writer.tag(11, runtime_1$8.WireType.Varint).int32(message.launchPadMode);
			if (message.uiDensity !== 0) writer.tag(12, runtime_1$8.WireType.Varint).int32(message.uiDensity);
			if (message.swipeRightToLeftMode !== 0) writer.tag(13, runtime_1$8.WireType.Varint).int32(message.swipeRightToLeftMode);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.AppearanceSettings
	*/
	exports.PreloadedUserSettings_AppearanceSettings = new PreloadedUserSettings_AppearanceSettings$Type();
	var PreloadedUserSettings_GuildFolder$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.GuildFolder", [
				{
					no: 1,
					name: "guild_ids",
					kind: "scalar",
					repeat: 1,
					T: 6,
					L: 0
				},
				{
					no: 2,
					name: "id",
					kind: "message",
					T: () => wrappers_1$1.Int64Value
				},
				{
					no: 3,
					name: "name",
					kind: "message",
					T: () => wrappers_6.StringValue
				},
				{
					no: 4,
					name: "color",
					kind: "message",
					T: () => wrappers_7.UInt64Value
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.guildIds = [];
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.guildIds.push(reader.fixed64().toBigInt());
else message.guildIds.push(reader.fixed64().toBigInt());
						break;
					case 2:
						message.id = wrappers_1$1.Int64Value.internalBinaryRead(reader, reader.uint32(), options, message.id);
						break;
					case 3:
						message.name = wrappers_6.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.name);
						break;
					case 4:
						message.color = wrappers_7.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.color);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.guildIds.length) {
				writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.guildIds.length; i++) writer.fixed64(message.guildIds[i]);
				writer.join();
			}
			if (message.id) wrappers_1$1.Int64Value.internalBinaryWrite(message.id, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.name) wrappers_6.StringValue.internalBinaryWrite(message.name, writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.color) wrappers_7.UInt64Value.internalBinaryWrite(message.color, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.GuildFolder
	*/
	exports.PreloadedUserSettings_GuildFolder = new PreloadedUserSettings_GuildFolder$Type();
	var PreloadedUserSettings_GuildFolders$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.GuildFolders", [{
				no: 1,
				name: "folders",
				kind: "message",
				repeat: 2,
				T: () => exports.PreloadedUserSettings_GuildFolder
			}, {
				no: 2,
				name: "guild_positions",
				kind: "scalar",
				repeat: 1,
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.folders = [];
			message.guildPositions = [];
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.folders.push(exports.PreloadedUserSettings_GuildFolder.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 2:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.guildPositions.push(reader.fixed64().toBigInt());
else message.guildPositions.push(reader.fixed64().toBigInt());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.folders.length; i++) exports.PreloadedUserSettings_GuildFolder.internalBinaryWrite(message.folders[i], writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.guildPositions.length) {
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.guildPositions.length; i++) writer.fixed64(message.guildPositions[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.GuildFolders
	*/
	exports.PreloadedUserSettings_GuildFolders = new PreloadedUserSettings_GuildFolders$Type();
	var PreloadedUserSettings_FavoriteChannel$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.FavoriteChannel", [
				{
					no: 1,
					name: "nickname",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "type",
					kind: "enum",
					T: () => [
						"discord_protos.discord_users.v1.PreloadedUserSettings.FavoriteChannelType",
						PreloadedUserSettings_FavoriteChannelType,
						"FAVORITE_CHANNEL_TYPE_"
					]
				},
				{
					no: 3,
					name: "position",
					kind: "scalar",
					T: 13
				},
				{
					no: 4,
					name: "parent_id",
					kind: "scalar",
					T: 6,
					L: 0
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.nickname = "";
			message.type = 0;
			message.position = 0;
			message.parentId = 0n;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.nickname = reader.string();
						break;
					case 2:
						message.type = reader.int32();
						break;
					case 3:
						message.position = reader.uint32();
						break;
					case 4:
						message.parentId = reader.fixed64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.nickname !== "") writer.tag(1, runtime_1$8.WireType.LengthDelimited).string(message.nickname);
			if (message.type !== 0) writer.tag(2, runtime_1$8.WireType.Varint).int32(message.type);
			if (message.position !== 0) writer.tag(3, runtime_1$8.WireType.Varint).uint32(message.position);
			if (message.parentId !== 0n) writer.tag(4, runtime_1$8.WireType.Bit64).fixed64(message.parentId);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.FavoriteChannel
	*/
	exports.PreloadedUserSettings_FavoriteChannel = new PreloadedUserSettings_FavoriteChannel$Type();
	var PreloadedUserSettings_Favorites$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.Favorites", [{
				no: 1,
				name: "favorite_channels",
				kind: "map",
				K: 6,
				V: {
					kind: "message",
					T: () => exports.PreloadedUserSettings_FavoriteChannel
				}
			}, {
				no: 2,
				name: "muted",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.favoriteChannels = {};
			message.muted = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.favoriteChannels, reader, options);
						break;
					case 2:
						message.muted = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.PreloadedUserSettings_FavoriteChannel.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.Favorites.favorite_channels");
				}
			}
			map[key ?? "0"] = val ?? exports.PreloadedUserSettings_FavoriteChannel.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.favoriteChannels)) {
				writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_FavoriteChannel.internalBinaryWrite(message.favoriteChannels[k], writer, options);
				writer.join().join();
			}
			if (message.muted !== false) writer.tag(2, runtime_1$8.WireType.Varint).bool(message.muted);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.Favorites
	*/
	exports.PreloadedUserSettings_Favorites = new PreloadedUserSettings_Favorites$Type();
	var PreloadedUserSettings_AudioContextSetting$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.AudioContextSetting", [
				{
					no: 1,
					name: "muted",
					kind: "scalar",
					T: 8
				},
				{
					no: 2,
					name: "volume",
					kind: "scalar",
					T: 2
				},
				{
					no: 3,
					name: "modified_at",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 4,
					name: "soundboard_muted",
					kind: "scalar",
					T: 8
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.muted = false;
			message.volume = 0;
			message.modifiedAt = 0n;
			message.soundboardMuted = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.muted = reader.bool();
						break;
					case 2:
						message.volume = reader.float();
						break;
					case 3:
						message.modifiedAt = reader.fixed64().toBigInt();
						break;
					case 4:
						message.soundboardMuted = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.muted !== false) writer.tag(1, runtime_1$8.WireType.Varint).bool(message.muted);
			if (message.volume !== 0) writer.tag(2, runtime_1$8.WireType.Bit32).float(message.volume);
			if (message.modifiedAt !== 0n) writer.tag(3, runtime_1$8.WireType.Bit64).fixed64(message.modifiedAt);
			if (message.soundboardMuted !== false) writer.tag(4, runtime_1$8.WireType.Varint).bool(message.soundboardMuted);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.AudioContextSetting
	*/
	exports.PreloadedUserSettings_AudioContextSetting = new PreloadedUserSettings_AudioContextSetting$Type();
	var PreloadedUserSettings_AudioSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.AudioSettings", [{
				no: 1,
				name: "user",
				kind: "map",
				K: 6,
				V: {
					kind: "message",
					T: () => exports.PreloadedUserSettings_AudioContextSetting
				}
			}, {
				no: 2,
				name: "stream",
				kind: "map",
				K: 6,
				V: {
					kind: "message",
					T: () => exports.PreloadedUserSettings_AudioContextSetting
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.user = {};
			message.stream = {};
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.user, reader, options);
						break;
					case 2:
						this.binaryReadMap2(message.stream, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.PreloadedUserSettings_AudioContextSetting.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.AudioSettings.user");
				}
			}
			map[key ?? "0"] = val ?? exports.PreloadedUserSettings_AudioContextSetting.create();
		}
		binaryReadMap2(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.PreloadedUserSettings_AudioContextSetting.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.AudioSettings.stream");
				}
			}
			map[key ?? "0"] = val ?? exports.PreloadedUserSettings_AudioContextSetting.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.user)) {
				writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_AudioContextSetting.internalBinaryWrite(message.user[k], writer, options);
				writer.join().join();
			}
			for (let k of globalThis.Object.keys(message.stream)) {
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_AudioContextSetting.internalBinaryWrite(message.stream[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.AudioSettings
	*/
	exports.PreloadedUserSettings_AudioSettings = new PreloadedUserSettings_AudioSettings$Type();
	var PreloadedUserSettings_CommunitiesSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.CommunitiesSettings", [{
				no: 1,
				name: "disable_home_auto_nav",
				kind: "message",
				T: () => wrappers_5.BoolValue
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.disableHomeAutoNav = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.disableHomeAutoNav);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.disableHomeAutoNav) wrappers_5.BoolValue.internalBinaryWrite(message.disableHomeAutoNav, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.CommunitiesSettings
	*/
	exports.PreloadedUserSettings_CommunitiesSettings = new PreloadedUserSettings_CommunitiesSettings$Type();
	var PreloadedUserSettings_BroadcastSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.BroadcastSettings", [
				{
					no: 1,
					name: "allow_friends",
					kind: "message",
					T: () => wrappers_5.BoolValue
				},
				{
					no: 2,
					name: "allowed_guild_ids",
					kind: "scalar",
					repeat: 1,
					T: 6,
					L: 0
				},
				{
					no: 3,
					name: "allowed_user_ids",
					kind: "scalar",
					repeat: 1,
					T: 6,
					L: 0
				},
				{
					no: 4,
					name: "auto_broadcast",
					kind: "message",
					T: () => wrappers_5.BoolValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.allowedGuildIds = [];
			message.allowedUserIds = [];
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.allowFriends = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.allowFriends);
						break;
					case 2:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.allowedGuildIds.push(reader.fixed64().toBigInt());
else message.allowedGuildIds.push(reader.fixed64().toBigInt());
						break;
					case 3:
						if (wireType === runtime_1$8.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.allowedUserIds.push(reader.fixed64().toBigInt());
else message.allowedUserIds.push(reader.fixed64().toBigInt());
						break;
					case 4:
						message.autoBroadcast = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.autoBroadcast);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.allowFriends) wrappers_5.BoolValue.internalBinaryWrite(message.allowFriends, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.allowedGuildIds.length) {
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.allowedGuildIds.length; i++) writer.fixed64(message.allowedGuildIds[i]);
				writer.join();
			}
			if (message.allowedUserIds.length) {
				writer.tag(3, runtime_1$8.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.allowedUserIds.length; i++) writer.fixed64(message.allowedUserIds[i]);
				writer.join();
			}
			if (message.autoBroadcast) wrappers_5.BoolValue.internalBinaryWrite(message.autoBroadcast, writer.tag(4, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.BroadcastSettings
	*/
	exports.PreloadedUserSettings_BroadcastSettings = new PreloadedUserSettings_BroadcastSettings$Type();
	var PreloadedUserSettings_ClipsSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ClipsSettings", [{
				no: 1,
				name: "allow_voice_recording",
				kind: "message",
				T: () => wrappers_5.BoolValue
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.allowVoiceRecording = wrappers_5.BoolValue.internalBinaryRead(reader, reader.uint32(), options, message.allowVoiceRecording);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.allowVoiceRecording) wrappers_5.BoolValue.internalBinaryWrite(message.allowVoiceRecording, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ClipsSettings
	*/
	exports.PreloadedUserSettings_ClipsSettings = new PreloadedUserSettings_ClipsSettings$Type();
	var PreloadedUserSettings_ForLaterSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ForLaterSettings", [{
				no: 1,
				name: "current_tab",
				kind: "enum",
				T: () => [
					"discord_protos.discord_users.v1.PreloadedUserSettings.ForLaterTab",
					PreloadedUserSettings_ForLaterTab,
					"FOR_LATER_TAB_"
				]
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.currentTab = 0;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.currentTab = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.currentTab !== 0) writer.tag(1, runtime_1$8.WireType.Varint).int32(message.currentTab);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ForLaterSettings
	*/
	exports.PreloadedUserSettings_ForLaterSettings = new PreloadedUserSettings_ForLaterSettings$Type();
	var PreloadedUserSettings_SafetySettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.SafetySettings", [{
				no: 1,
				name: "safety_settings_preset",
				kind: "enum",
				T: () => [
					"discord_protos.discord_users.v1.PreloadedUserSettings.SafetySettingsPresetType",
					PreloadedUserSettings_SafetySettingsPresetType,
					"SAFETY_SETTINGS_PRESET_TYPE_"
				]
			}, {
				no: 2,
				name: "ignore_profile_speedbump_disabled",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.safetySettingsPreset = 0;
			message.ignoreProfileSpeedbumpDisabled = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.safetySettingsPreset = reader.int32();
						break;
					case 2:
						message.ignoreProfileSpeedbumpDisabled = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.safetySettingsPreset !== 0) writer.tag(1, runtime_1$8.WireType.Varint).int32(message.safetySettingsPreset);
			if (message.ignoreProfileSpeedbumpDisabled !== false) writer.tag(2, runtime_1$8.WireType.Varint).bool(message.ignoreProfileSpeedbumpDisabled);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.SafetySettings
	*/
	exports.PreloadedUserSettings_SafetySettings = new PreloadedUserSettings_SafetySettings$Type();
	var PreloadedUserSettings_ICYMISettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ICYMISettings", [{
				no: 1,
				name: "feed_generated_at",
				kind: "scalar",
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.feedGeneratedAt = 0n;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.feedGeneratedAt = reader.fixed64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.feedGeneratedAt !== 0n) writer.tag(1, runtime_1$8.WireType.Bit64).fixed64(message.feedGeneratedAt);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ICYMISettings
	*/
	exports.PreloadedUserSettings_ICYMISettings = new PreloadedUserSettings_ICYMISettings$Type();
	var PreloadedUserSettings_ApplicationDMSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ApplicationDMSettings", [{
				no: 2,
				name: "allow_mobile_push",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.allowMobilePush = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 2:
						message.allowMobilePush = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.allowMobilePush !== false) writer.tag(2, runtime_1$8.WireType.Varint).bool(message.allowMobilePush);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ApplicationDMSettings
	*/
	exports.PreloadedUserSettings_ApplicationDMSettings = new PreloadedUserSettings_ApplicationDMSettings$Type();
	var PreloadedUserSettings_ApplicationSharingSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ApplicationSharingSettings", [{
				no: 1,
				name: "disable_application_activity_sharing",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.disableApplicationActivitySharing = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.disableApplicationActivitySharing = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.disableApplicationActivitySharing !== false) writer.tag(1, runtime_1$8.WireType.Varint).bool(message.disableApplicationActivitySharing);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ApplicationSharingSettings
	*/
	exports.PreloadedUserSettings_ApplicationSharingSettings = new PreloadedUserSettings_ApplicationSharingSettings$Type();
	var PreloadedUserSettings_ApplicationSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.ApplicationSettings", [{
				no: 1,
				name: "app_dm_settings",
				kind: "message",
				T: () => exports.PreloadedUserSettings_ApplicationDMSettings
			}, {
				no: 2,
				name: "app_sharing_settings",
				kind: "message",
				T: () => exports.PreloadedUserSettings_ApplicationSharingSettings
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.appDmSettings = exports.PreloadedUserSettings_ApplicationDMSettings.internalBinaryRead(reader, reader.uint32(), options, message.appDmSettings);
						break;
					case 2:
						message.appSharingSettings = exports.PreloadedUserSettings_ApplicationSharingSettings.internalBinaryRead(reader, reader.uint32(), options, message.appSharingSettings);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.appDmSettings) exports.PreloadedUserSettings_ApplicationDMSettings.internalBinaryWrite(message.appDmSettings, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.appSharingSettings) exports.PreloadedUserSettings_ApplicationSharingSettings.internalBinaryWrite(message.appSharingSettings, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.ApplicationSettings
	*/
	exports.PreloadedUserSettings_ApplicationSettings = new PreloadedUserSettings_ApplicationSettings$Type();
	var PreloadedUserSettings_AllApplicationSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.AllApplicationSettings", [{
				no: 1,
				name: "app_settings",
				kind: "map",
				K: 6,
				V: {
					kind: "message",
					T: () => exports.PreloadedUserSettings_ApplicationSettings
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.appSettings = {};
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.appSettings, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.PreloadedUserSettings_ApplicationSettings.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.AllApplicationSettings.app_settings");
				}
			}
			map[key ?? "0"] = val ?? exports.PreloadedUserSettings_ApplicationSettings.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.appSettings)) {
				writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_ApplicationSettings.internalBinaryWrite(message.appSettings[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.AllApplicationSettings
	*/
	exports.PreloadedUserSettings_AllApplicationSettings = new PreloadedUserSettings_AllApplicationSettings$Type();
	var PreloadedUserSettings_AdsSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.AdsSettings", [{
				no: 1,
				name: "always_deliver",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.alwaysDeliver = false;
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.alwaysDeliver = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.alwaysDeliver !== false) writer.tag(1, runtime_1$8.WireType.Varint).bool(message.alwaysDeliver);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.AdsSettings
	*/
	exports.PreloadedUserSettings_AdsSettings = new PreloadedUserSettings_AdsSettings$Type();
	var PreloadedUserSettings_InAppFeedbackState$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.InAppFeedbackState", [{
				no: 1,
				name: "last_impression_time",
				kind: "message",
				T: () => wrappers_7.UInt64Value
			}, {
				no: 2,
				name: "opt_out_expiry_time",
				kind: "message",
				T: () => wrappers_7.UInt64Value
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.lastImpressionTime = wrappers_7.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.lastImpressionTime);
						break;
					case 2:
						message.optOutExpiryTime = wrappers_7.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.optOutExpiryTime);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.lastImpressionTime) wrappers_7.UInt64Value.internalBinaryWrite(message.lastImpressionTime, writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			if (message.optOutExpiryTime) wrappers_7.UInt64Value.internalBinaryWrite(message.optOutExpiryTime, writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.InAppFeedbackState
	*/
	exports.PreloadedUserSettings_InAppFeedbackState = new PreloadedUserSettings_InAppFeedbackState$Type();
	var PreloadedUserSettings_InAppFeedbackSettings$Type = class extends runtime_4$7.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.PreloadedUserSettings.InAppFeedbackSettings", [{
				no: 1,
				name: "in_app_feedback_states",
				kind: "map",
				K: 5,
				V: {
					kind: "message",
					T: () => exports.PreloadedUserSettings_InAppFeedbackState
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.inAppFeedbackStates = {};
			if (value !== undefined) (0, runtime_3$7.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.inAppFeedbackStates, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.int32();
						break;
					case 2:
						val = exports.PreloadedUserSettings_InAppFeedbackState.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.PreloadedUserSettings.InAppFeedbackSettings.in_app_feedback_states");
				}
			}
			map[key ?? 0] = val ?? exports.PreloadedUserSettings_InAppFeedbackState.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.inAppFeedbackStates)) {
				writer.tag(1, runtime_1$8.WireType.LengthDelimited).fork().tag(1, runtime_1$8.WireType.Varint).int32(parseInt(k));
				writer.tag(2, runtime_1$8.WireType.LengthDelimited).fork();
				exports.PreloadedUserSettings_InAppFeedbackState.internalBinaryWrite(message.inAppFeedbackStates[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.PreloadedUserSettings.InAppFeedbackSettings
	*/
	exports.PreloadedUserSettings_InAppFeedbackSettings = new PreloadedUserSettings_InAppFeedbackSettings$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_experimentation/v1/Experiment.js
var require_Experiment = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_experimentation/v1/Experiment.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Experiment_DebugConfig = exports.Experiment_Rule = exports.Experiment_Override = exports.Experiment_Filter = exports.Experiment_UserPremiumType = exports.Experiment_UnitIdInExperiment = exports.Experiment_ClientSystemLocale = exports.Experiment_Always = exports.Experiment_ClientReleaseChannel = exports.Experiment_UnitIdInRangeByHash = exports.Experiment_UserHasFlag = exports.Experiment_UserIDRange = exports.Experiment_Fixed64Value = exports.Experiment_UserAgeRange = exports.Experiment_UserIsBot = exports.Experiment_UserLocale = exports.Experiment_ClientIP = exports.Experiment_ClientLocation = exports.Experiment_Location = exports.Experiment_Place = exports.Experiment_ISORegion = exports.Experiment_ClientLocale = exports.Experiment_UserIds = exports.Experiment_UserInGuild = exports.Experiment_StaffUsers = exports.Experiment_ClientOperatingSystem = exports.Experiment_SDKVersion = exports.Experiment_SDKVersionRange = exports.Experiment_SDKVersionRangeBound = exports.Experiment_SDKVersionSpecifier = exports.Experiment_ClientPlatform = exports.Experiment_ClientRequiredChanges = exports.Experiment_PlatformVersion = exports.Experiment_PlatformVersionRange = exports.Experiment_PlatformVersionRangeBound = exports.Experiment_PlatformVersionSpecifier = exports.Experiment_Variation = exports.Experiment_Bucket = exports.Experiment = exports.Experiment_AssignmentMode = exports.Experiment_ExposureTracking = exports.Experiment_Surface = exports.Experiment_Phase = exports.Experiment_Type = exports.Experiment_UnitType = void 0;
	const runtime_1$7 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$6 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$6 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$6 = (init_es2015(), __toCommonJS(es2015_exports));
	const wrappers_1 = require_wrappers();
	const wrappers_2 = require_wrappers();
	const wrappers_3 = require_wrappers();
	const timestamp_1$1 = require_timestamp();
	/**
	* @generated from protobuf enum discord_protos.discord_experimentation.v1.Experiment.UnitType
	*/
	var Experiment_UnitType;
	(function(Experiment_UnitType$1) {
		/**
		* @generated from protobuf enum value: UNIT_TYPE_UNSPECIFIED = 0;
		*/
		Experiment_UnitType$1[Experiment_UnitType$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: UNIT_TYPE_USER = 1;
		*/
		Experiment_UnitType$1[Experiment_UnitType$1["USER"] = 1] = "USER";
	})(Experiment_UnitType || (exports.Experiment_UnitType = Experiment_UnitType = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_experimentation.v1.Experiment.Type
	*/
	var Experiment_Type;
	(function(Experiment_Type$1) {
		/**
		* @generated from protobuf enum value: TYPE_UNSPECIFIED = 0;
		*/
		Experiment_Type$1[Experiment_Type$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: TYPE_ACTIVE = 1;
		*/
		Experiment_Type$1[Experiment_Type$1["ACTIVE"] = 1] = "ACTIVE";
		/**
		* @generated from protobuf enum value: TYPE_UNUSED = 2;
		*/
		Experiment_Type$1[Experiment_Type$1["UNUSED"] = 2] = "UNUSED";
		/**
		* @generated from protobuf enum value: TYPE_BURNED = 3;
		*/
		Experiment_Type$1[Experiment_Type$1["BURNED"] = 3] = "BURNED";
	})(Experiment_Type || (exports.Experiment_Type = Experiment_Type = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_experimentation.v1.Experiment.Phase
	*/
	var Experiment_Phase;
	(function(Experiment_Phase$1) {
		/**
		* @generated from protobuf enum value: PHASE_UNSPECIFIED = 0;
		*/
		Experiment_Phase$1[Experiment_Phase$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: PHASE_DRAFT = 1;
		*/
		Experiment_Phase$1[Experiment_Phase$1["DRAFT"] = 1] = "DRAFT";
		/**
		* @generated from protobuf enum value: PHASE_MEASUREMENT = 2;
		*/
		Experiment_Phase$1[Experiment_Phase$1["MEASUREMENT"] = 2] = "MEASUREMENT";
		/**
		* @generated from protobuf enum value: PHASE_MEASUREMENT_ENDED = 3;
		*/
		Experiment_Phase$1[Experiment_Phase$1["MEASUREMENT_ENDED"] = 3] = "MEASUREMENT_ENDED";
		/**
		* @generated from protobuf enum value: PHASE_ROLLING_OUT = 4;
		*/
		Experiment_Phase$1[Experiment_Phase$1["ROLLING_OUT"] = 4] = "ROLLING_OUT";
		/**
		* @generated from protobuf enum value: PHASE_ROLLED_OUT = 5;
		*/
		Experiment_Phase$1[Experiment_Phase$1["ROLLED_OUT"] = 5] = "ROLLED_OUT";
		/**
		* @generated from protobuf enum value: PHASE_ARCHIVED = 6;
		*/
		Experiment_Phase$1[Experiment_Phase$1["ARCHIVED"] = 6] = "ARCHIVED";
		/**
		* @generated from protobuf enum value: PHASE_AA_MODE = 7;
		*/
		Experiment_Phase$1[Experiment_Phase$1["AA_MODE"] = 7] = "AA_MODE";
	})(Experiment_Phase || (exports.Experiment_Phase = Experiment_Phase = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_experimentation.v1.Experiment.Surface
	*/
	var Experiment_Surface;
	(function(Experiment_Surface$1) {
		/**
		* @generated from protobuf enum value: SURFACE_UNSPECIFIED = 0;
		*/
		Experiment_Surface$1[Experiment_Surface$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: SURFACE_API = 1;
		*/
		Experiment_Surface$1[Experiment_Surface$1["API"] = 1] = "API";
		/**
		* @generated from protobuf enum value: SURFACE_APP = 2;
		*/
		Experiment_Surface$1[Experiment_Surface$1["APP"] = 2] = "APP";
		/**
		* @generated from protobuf enum value: SURFACE_DEVELOPER_PORTAL = 3;
		*/
		Experiment_Surface$1[Experiment_Surface$1["DEVELOPER_PORTAL"] = 3] = "DEVELOPER_PORTAL";
		/**
		* @generated from protobuf enum value: SURFACE_ADMIN_PANEL = 4;
		*/
		Experiment_Surface$1[Experiment_Surface$1["ADMIN_PANEL"] = 4] = "ADMIN_PANEL";
		/**
		* @generated from protobuf enum value: SURFACE_ADS_BUDGET_AB = 5;
		*/
		Experiment_Surface$1[Experiment_Surface$1["ADS_BUDGET_AB"] = 5] = "ADS_BUDGET_AB";
	})(Experiment_Surface || (exports.Experiment_Surface = Experiment_Surface = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_experimentation.v1.Experiment.ExposureTracking
	*/
	var Experiment_ExposureTracking;
	(function(Experiment_ExposureTracking$1) {
		/**
		* @generated from protobuf enum value: EXPOSURE_TRACKING_ENABLED = 0;
		*/
		Experiment_ExposureTracking$1[Experiment_ExposureTracking$1["ENABLED"] = 0] = "ENABLED";
		/**
		* @generated from protobuf enum value: EXPOSURE_TRACKING_DISABLED = 1;
		*/
		Experiment_ExposureTracking$1[Experiment_ExposureTracking$1["DISABLED"] = 1] = "DISABLED";
	})(Experiment_ExposureTracking || (exports.Experiment_ExposureTracking = Experiment_ExposureTracking = {}));
	/**
	* @generated from protobuf enum discord_protos.discord_experimentation.v1.Experiment.AssignmentMode
	*/
	var Experiment_AssignmentMode;
	(function(Experiment_AssignmentMode$1) {
		/**
		* @generated from protobuf enum value: ASSIGNMENT_MODE_FULL = 0;
		*/
		Experiment_AssignmentMode$1[Experiment_AssignmentMode$1["FULL"] = 0] = "FULL";
		/**
		* @generated from protobuf enum value: ASSIGNMENT_MODE_FORCE_CONTROL = 3;
		*/
		Experiment_AssignmentMode$1[Experiment_AssignmentMode$1["FORCE_CONTROL"] = 3] = "FORCE_CONTROL";
		/**
		* @generated from protobuf enum value: ASSIGNMENT_MODE_OVERRIDES_ONLY = 4;
		*/
		Experiment_AssignmentMode$1[Experiment_AssignmentMode$1["OVERRIDES_ONLY"] = 4] = "OVERRIDES_ONLY";
		/**
		* @generated from protobuf enum value: ASSIGNMENT_MODE_OFF = 5;
		*/
		Experiment_AssignmentMode$1[Experiment_AssignmentMode$1["OFF"] = 5] = "OFF";
	})(Experiment_AssignmentMode || (exports.Experiment_AssignmentMode = Experiment_AssignmentMode = {}));
	var Experiment$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment", [
				{
					no: 1,
					name: "id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 2,
					name: "name",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "created_at",
					kind: "message",
					T: () => timestamp_1$1.Timestamp
				},
				{
					no: 4,
					name: "creator_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 5,
					name: "version",
					kind: "scalar",
					T: 5
				},
				{
					no: 6,
					name: "edited_at",
					kind: "message",
					T: () => timestamp_1$1.Timestamp
				},
				{
					no: 7,
					name: "editor_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 8,
					name: "title",
					kind: "scalar",
					T: 9
				},
				{
					no: 9,
					name: "description",
					kind: "scalar",
					T: 9
				},
				{
					no: 10,
					name: "hypothesis",
					kind: "message",
					T: () => wrappers_3.StringValue
				},
				{
					no: 11,
					name: "tech_spec_link",
					kind: "message",
					T: () => wrappers_3.StringValue
				},
				{
					no: 12,
					name: "revision",
					kind: "scalar",
					T: 5
				},
				{
					no: 13,
					name: "hash_key",
					kind: "scalar",
					T: 9
				},
				{
					no: 14,
					name: "unit_type",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.UnitType",
						Experiment_UnitType,
						"UNIT_TYPE_"
					]
				},
				{
					no: 15,
					name: "variations",
					kind: "message",
					repeat: 2,
					T: () => exports.Experiment_Variation
				},
				{
					no: 16,
					name: "rules",
					kind: "message",
					repeat: 2,
					T: () => exports.Experiment_Rule
				},
				{
					no: 18,
					name: "phase",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.Phase",
						Experiment_Phase,
						"PHASE_"
					]
				},
				{
					no: 19,
					name: "surfaces",
					kind: "enum",
					repeat: 1,
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.Surface",
						Experiment_Surface,
						"SURFACE_"
					]
				},
				{
					no: 20,
					name: "owning_team_id",
					kind: "scalar",
					T: 9
				},
				{
					no: 21,
					name: "cached_notification_channel_id",
					kind: "scalar",
					T: 6,
					L: 0
				},
				{
					no: 22,
					name: "exposure_tracking",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.ExposureTracking",
						Experiment_ExposureTracking,
						"EXPOSURE_TRACKING_"
					]
				},
				{
					no: 25,
					name: "assignment_mode",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.AssignmentMode",
						Experiment_AssignmentMode,
						"ASSIGNMENT_MODE_"
					]
				},
				{
					no: 23,
					name: "enable_edit_raw_json_ui",
					kind: "scalar",
					T: 8
				},
				{
					no: 24,
					name: "winning_variation_id",
					kind: "scalar",
					T: 5
				},
				{
					no: 26,
					name: "type",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.Type",
						Experiment_Type,
						"TYPE_"
					]
				},
				{
					no: 27,
					name: "is_template",
					kind: "scalar",
					T: 8
				},
				{
					no: 28,
					name: "field_numbers_to_copy",
					kind: "scalar",
					repeat: 1,
					T: 5
				},
				{
					no: 29,
					name: "engine_feature_flags",
					kind: "scalar",
					repeat: 2,
					T: 9
				},
				{
					no: 30,
					name: "debug_config",
					kind: "message",
					T: () => exports.Experiment_DebugConfig
				},
				{
					no: 31,
					name: "expected_end_date",
					kind: "message",
					T: () => timestamp_1$1.Timestamp
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.id = 0n;
			message.name = "";
			message.creatorId = 0n;
			message.version = 0;
			message.editorId = 0n;
			message.title = "";
			message.description = "";
			message.revision = 0;
			message.hashKey = "";
			message.unitType = 0;
			message.variations = [];
			message.rules = [];
			message.phase = 0;
			message.surfaces = [];
			message.owningTeamId = "";
			message.cachedNotificationChannelId = 0n;
			message.exposureTracking = 0;
			message.assignmentMode = 0;
			message.enableEditRawJsonUi = false;
			message.winningVariationId = 0;
			message.type = 0;
			message.isTemplate = false;
			message.fieldNumbersToCopy = [];
			message.engineFeatureFlags = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.id = reader.fixed64().toBigInt();
						break;
					case 2:
						message.name = reader.string();
						break;
					case 3:
						message.createdAt = timestamp_1$1.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.createdAt);
						break;
					case 4:
						message.creatorId = reader.fixed64().toBigInt();
						break;
					case 5:
						message.version = reader.int32();
						break;
					case 6:
						message.editedAt = timestamp_1$1.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.editedAt);
						break;
					case 7:
						message.editorId = reader.fixed64().toBigInt();
						break;
					case 8:
						message.title = reader.string();
						break;
					case 9:
						message.description = reader.string();
						break;
					case 10:
						message.hypothesis = wrappers_3.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.hypothesis);
						break;
					case 11:
						message.techSpecLink = wrappers_3.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.techSpecLink);
						break;
					case 12:
						message.revision = reader.int32();
						break;
					case 13:
						message.hashKey = reader.string();
						break;
					case 14:
						message.unitType = reader.int32();
						break;
					case 15:
						message.variations.push(exports.Experiment_Variation.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 16:
						message.rules.push(exports.Experiment_Rule.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 18:
						message.phase = reader.int32();
						break;
					case 19:
						if (wireType === runtime_2$6.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.surfaces.push(reader.int32());
else message.surfaces.push(reader.int32());
						break;
					case 20:
						message.owningTeamId = reader.string();
						break;
					case 21:
						message.cachedNotificationChannelId = reader.fixed64().toBigInt();
						break;
					case 22:
						message.exposureTracking = reader.int32();
						break;
					case 25:
						message.assignmentMode = reader.int32();
						break;
					case 23:
						message.enableEditRawJsonUi = reader.bool();
						break;
					case 24:
						message.winningVariationId = reader.int32();
						break;
					case 26:
						message.type = reader.int32();
						break;
					case 27:
						message.isTemplate = reader.bool();
						break;
					case 28:
						if (wireType === runtime_2$6.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.fieldNumbersToCopy.push(reader.int32());
else message.fieldNumbersToCopy.push(reader.int32());
						break;
					case 29:
						message.engineFeatureFlags.push(reader.string());
						break;
					case 30:
						message.debugConfig = exports.Experiment_DebugConfig.internalBinaryRead(reader, reader.uint32(), options, message.debugConfig);
						break;
					case 31:
						message.expectedEndDate = timestamp_1$1.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.expectedEndDate);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.id !== 0n) writer.tag(1, runtime_2$6.WireType.Bit64).fixed64(message.id);
			if (message.name !== "") writer.tag(2, runtime_2$6.WireType.LengthDelimited).string(message.name);
			if (message.createdAt) timestamp_1$1.Timestamp.internalBinaryWrite(message.createdAt, writer.tag(3, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.creatorId !== 0n) writer.tag(4, runtime_2$6.WireType.Bit64).fixed64(message.creatorId);
			if (message.version !== 0) writer.tag(5, runtime_2$6.WireType.Varint).int32(message.version);
			if (message.editedAt) timestamp_1$1.Timestamp.internalBinaryWrite(message.editedAt, writer.tag(6, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.editorId !== 0n) writer.tag(7, runtime_2$6.WireType.Bit64).fixed64(message.editorId);
			if (message.title !== "") writer.tag(8, runtime_2$6.WireType.LengthDelimited).string(message.title);
			if (message.description !== "") writer.tag(9, runtime_2$6.WireType.LengthDelimited).string(message.description);
			if (message.hypothesis) wrappers_3.StringValue.internalBinaryWrite(message.hypothesis, writer.tag(10, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.techSpecLink) wrappers_3.StringValue.internalBinaryWrite(message.techSpecLink, writer.tag(11, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.revision !== 0) writer.tag(12, runtime_2$6.WireType.Varint).int32(message.revision);
			if (message.hashKey !== "") writer.tag(13, runtime_2$6.WireType.LengthDelimited).string(message.hashKey);
			if (message.unitType !== 0) writer.tag(14, runtime_2$6.WireType.Varint).int32(message.unitType);
			for (let i = 0; i < message.variations.length; i++) exports.Experiment_Variation.internalBinaryWrite(message.variations[i], writer.tag(15, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			for (let i = 0; i < message.rules.length; i++) exports.Experiment_Rule.internalBinaryWrite(message.rules[i], writer.tag(16, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.phase !== 0) writer.tag(18, runtime_2$6.WireType.Varint).int32(message.phase);
			if (message.surfaces.length) {
				writer.tag(19, runtime_2$6.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.surfaces.length; i++) writer.int32(message.surfaces[i]);
				writer.join();
			}
			if (message.owningTeamId !== "") writer.tag(20, runtime_2$6.WireType.LengthDelimited).string(message.owningTeamId);
			if (message.cachedNotificationChannelId !== 0n) writer.tag(21, runtime_2$6.WireType.Bit64).fixed64(message.cachedNotificationChannelId);
			if (message.exposureTracking !== 0) writer.tag(22, runtime_2$6.WireType.Varint).int32(message.exposureTracking);
			if (message.enableEditRawJsonUi !== false) writer.tag(23, runtime_2$6.WireType.Varint).bool(message.enableEditRawJsonUi);
			if (message.winningVariationId !== 0) writer.tag(24, runtime_2$6.WireType.Varint).int32(message.winningVariationId);
			if (message.assignmentMode !== 0) writer.tag(25, runtime_2$6.WireType.Varint).int32(message.assignmentMode);
			if (message.type !== 0) writer.tag(26, runtime_2$6.WireType.Varint).int32(message.type);
			if (message.isTemplate !== false) writer.tag(27, runtime_2$6.WireType.Varint).bool(message.isTemplate);
			if (message.fieldNumbersToCopy.length) {
				writer.tag(28, runtime_2$6.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.fieldNumbersToCopy.length; i++) writer.int32(message.fieldNumbersToCopy[i]);
				writer.join();
			}
			for (let i = 0; i < message.engineFeatureFlags.length; i++) writer.tag(29, runtime_2$6.WireType.LengthDelimited).string(message.engineFeatureFlags[i]);
			if (message.debugConfig) exports.Experiment_DebugConfig.internalBinaryWrite(message.debugConfig, writer.tag(30, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.expectedEndDate) timestamp_1$1.Timestamp.internalBinaryWrite(message.expectedEndDate, writer.tag(31, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment
	*/
	exports.Experiment = new Experiment$Type();
	var Experiment_Bucket$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Bucket", [
				{
					no: 1,
					name: "start",
					kind: "scalar",
					T: 5
				},
				{
					no: 2,
					name: "stop",
					kind: "scalar",
					T: 5
				},
				{
					no: 3,
					name: "type",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.Type",
						Experiment_Type,
						"TYPE_"
					]
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.start = 0;
			message.stop = 0;
			message.type = 0;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.start = reader.int32();
						break;
					case 2:
						message.stop = reader.int32();
						break;
					case 3:
						message.type = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.start !== 0) writer.tag(1, runtime_2$6.WireType.Varint).int32(message.start);
			if (message.stop !== 0) writer.tag(2, runtime_2$6.WireType.Varint).int32(message.stop);
			if (message.type !== 0) writer.tag(3, runtime_2$6.WireType.Varint).int32(message.type);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Bucket
	*/
	exports.Experiment_Bucket = new Experiment_Bucket$Type();
	var Experiment_Variation$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Variation", [
				{
					no: 1,
					name: "id",
					kind: "scalar",
					T: 5
				},
				{
					no: 2,
					name: "label",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "target_allocation",
					kind: "scalar",
					T: 5
				},
				{
					no: 4,
					name: "buckets",
					kind: "message",
					repeat: 2,
					T: () => exports.Experiment_Bucket
				},
				{
					no: 5,
					name: "type",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.Type",
						Experiment_Type,
						"TYPE_"
					]
				},
				{
					no: 6,
					name: "configuration",
					kind: "message",
					T: () => wrappers_3.StringValue
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.id = 0;
			message.label = "";
			message.targetAllocation = 0;
			message.buckets = [];
			message.type = 0;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.id = reader.int32();
						break;
					case 2:
						message.label = reader.string();
						break;
					case 3:
						message.targetAllocation = reader.int32();
						break;
					case 4:
						message.buckets.push(exports.Experiment_Bucket.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 5:
						message.type = reader.int32();
						break;
					case 6:
						message.configuration = wrappers_3.StringValue.internalBinaryRead(reader, reader.uint32(), options, message.configuration);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.id !== 0) writer.tag(1, runtime_2$6.WireType.Varint).int32(message.id);
			if (message.label !== "") writer.tag(2, runtime_2$6.WireType.LengthDelimited).string(message.label);
			if (message.targetAllocation !== 0) writer.tag(3, runtime_2$6.WireType.Varint).int32(message.targetAllocation);
			for (let i = 0; i < message.buckets.length; i++) exports.Experiment_Bucket.internalBinaryWrite(message.buckets[i], writer.tag(4, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.type !== 0) writer.tag(5, runtime_2$6.WireType.Varint).int32(message.type);
			if (message.configuration) wrappers_3.StringValue.internalBinaryWrite(message.configuration, writer.tag(6, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Variation
	*/
	exports.Experiment_Variation = new Experiment_Variation$Type();
	var Experiment_PlatformVersionSpecifier$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.PlatformVersionSpecifier", [
				{
					no: 1,
					name: "major",
					kind: "scalar",
					T: 13
				},
				{
					no: 2,
					name: "minor",
					kind: "message",
					T: () => wrappers_2.UInt32Value
				},
				{
					no: 3,
					name: "build",
					kind: "message",
					T: () => wrappers_1.UInt64Value
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.major = 0;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.major = reader.uint32();
						break;
					case 2:
						message.minor = wrappers_2.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.minor);
						break;
					case 3:
						message.build = wrappers_1.UInt64Value.internalBinaryRead(reader, reader.uint32(), options, message.build);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.major !== 0) writer.tag(1, runtime_2$6.WireType.Varint).uint32(message.major);
			if (message.minor) wrappers_2.UInt32Value.internalBinaryWrite(message.minor, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.build) wrappers_1.UInt64Value.internalBinaryWrite(message.build, writer.tag(3, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.PlatformVersionSpecifier
	*/
	exports.Experiment_PlatformVersionSpecifier = new Experiment_PlatformVersionSpecifier$Type();
	var Experiment_PlatformVersionRangeBound$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.PlatformVersionRangeBound", [{
				no: 1,
				name: "version",
				kind: "message",
				T: () => exports.Experiment_PlatformVersionSpecifier
			}, {
				no: 2,
				name: "inclusive",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.inclusive = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.version = exports.Experiment_PlatformVersionSpecifier.internalBinaryRead(reader, reader.uint32(), options, message.version);
						break;
					case 2:
						message.inclusive = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.version) exports.Experiment_PlatformVersionSpecifier.internalBinaryWrite(message.version, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.inclusive !== false) writer.tag(2, runtime_2$6.WireType.Varint).bool(message.inclusive);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.PlatformVersionRangeBound
	*/
	exports.Experiment_PlatformVersionRangeBound = new Experiment_PlatformVersionRangeBound$Type();
	var Experiment_PlatformVersionRange$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.PlatformVersionRange", [{
				no: 1,
				name: "lower_bound",
				kind: "message",
				T: () => exports.Experiment_PlatformVersionRangeBound
			}, {
				no: 2,
				name: "upper_bound",
				kind: "message",
				T: () => exports.Experiment_PlatformVersionRangeBound
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.lowerBound = exports.Experiment_PlatformVersionRangeBound.internalBinaryRead(reader, reader.uint32(), options, message.lowerBound);
						break;
					case 2:
						message.upperBound = exports.Experiment_PlatformVersionRangeBound.internalBinaryRead(reader, reader.uint32(), options, message.upperBound);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.lowerBound) exports.Experiment_PlatformVersionRangeBound.internalBinaryWrite(message.lowerBound, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.upperBound) exports.Experiment_PlatformVersionRangeBound.internalBinaryWrite(message.upperBound, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.PlatformVersionRange
	*/
	exports.Experiment_PlatformVersionRange = new Experiment_PlatformVersionRange$Type();
	var Experiment_PlatformVersion$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.PlatformVersion", [{
				no: 1,
				name: "ranges",
				kind: "message",
				repeat: 2,
				T: () => exports.Experiment_PlatformVersionRange
			}, {
				no: 2,
				name: "work_around_pyoto_bug",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.ranges = [];
			message.workAroundPyotoBug = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.ranges.push(exports.Experiment_PlatformVersionRange.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 2:
						message.workAroundPyotoBug = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.ranges.length; i++) exports.Experiment_PlatformVersionRange.internalBinaryWrite(message.ranges[i], writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.workAroundPyotoBug !== false) writer.tag(2, runtime_2$6.WireType.Varint).bool(message.workAroundPyotoBug);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.PlatformVersion
	*/
	exports.Experiment_PlatformVersion = new Experiment_PlatformVersion$Type();
	var Experiment_ClientRequiredChanges$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientRequiredChanges", [{
				no: 1,
				name: "commit_hashes",
				kind: "scalar",
				repeat: 2,
				T: 9
			}, {
				no: 2,
				name: "pr_numbers",
				kind: "scalar",
				repeat: 1,
				T: 5
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.commitHashes = [];
			message.prNumbers = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.commitHashes.push(reader.string());
						break;
					case 2:
						if (wireType === runtime_2$6.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.prNumbers.push(reader.int32());
else message.prNumbers.push(reader.int32());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.commitHashes.length; i++) writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.commitHashes[i]);
			if (message.prNumbers.length) {
				writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.prNumbers.length; i++) writer.int32(message.prNumbers[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientRequiredChanges
	*/
	exports.Experiment_ClientRequiredChanges = new Experiment_ClientRequiredChanges$Type();
	var Experiment_ClientPlatform$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientPlatform", [
				{
					no: 1,
					name: "ios_version",
					kind: "message",
					T: () => exports.Experiment_PlatformVersion
				},
				{
					no: 2,
					name: "android_version",
					kind: "message",
					T: () => exports.Experiment_PlatformVersion
				},
				{
					no: 3,
					name: "web_version",
					kind: "message",
					T: () => exports.Experiment_PlatformVersion
				},
				{
					no: 4,
					name: "native_version",
					kind: "message",
					T: () => exports.Experiment_PlatformVersion
				},
				{
					no: 6,
					name: "allow_non_native_web",
					kind: "scalar",
					T: 8
				},
				{
					no: 5,
					name: "client_required_changes",
					kind: "message",
					T: () => exports.Experiment_ClientRequiredChanges
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.allowNonNativeWeb = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.iosVersion = exports.Experiment_PlatformVersion.internalBinaryRead(reader, reader.uint32(), options, message.iosVersion);
						break;
					case 2:
						message.androidVersion = exports.Experiment_PlatformVersion.internalBinaryRead(reader, reader.uint32(), options, message.androidVersion);
						break;
					case 3:
						message.webVersion = exports.Experiment_PlatformVersion.internalBinaryRead(reader, reader.uint32(), options, message.webVersion);
						break;
					case 4:
						message.nativeVersion = exports.Experiment_PlatformVersion.internalBinaryRead(reader, reader.uint32(), options, message.nativeVersion);
						break;
					case 6:
						message.allowNonNativeWeb = reader.bool();
						break;
					case 5:
						message.clientRequiredChanges = exports.Experiment_ClientRequiredChanges.internalBinaryRead(reader, reader.uint32(), options, message.clientRequiredChanges);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.iosVersion) exports.Experiment_PlatformVersion.internalBinaryWrite(message.iosVersion, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.androidVersion) exports.Experiment_PlatformVersion.internalBinaryWrite(message.androidVersion, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.webVersion) exports.Experiment_PlatformVersion.internalBinaryWrite(message.webVersion, writer.tag(3, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.nativeVersion) exports.Experiment_PlatformVersion.internalBinaryWrite(message.nativeVersion, writer.tag(4, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.clientRequiredChanges) exports.Experiment_ClientRequiredChanges.internalBinaryWrite(message.clientRequiredChanges, writer.tag(5, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.allowNonNativeWeb !== false) writer.tag(6, runtime_2$6.WireType.Varint).bool(message.allowNonNativeWeb);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientPlatform
	*/
	exports.Experiment_ClientPlatform = new Experiment_ClientPlatform$Type();
	var Experiment_SDKVersionSpecifier$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.SDKVersionSpecifier", [{
				no: 1,
				name: "version",
				kind: "scalar",
				T: 5
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.version = 0;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.version = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.version !== 0) writer.tag(1, runtime_2$6.WireType.Varint).int32(message.version);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.SDKVersionSpecifier
	*/
	exports.Experiment_SDKVersionSpecifier = new Experiment_SDKVersionSpecifier$Type();
	var Experiment_SDKVersionRangeBound$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.SDKVersionRangeBound", [{
				no: 1,
				name: "version",
				kind: "message",
				T: () => exports.Experiment_SDKVersionSpecifier
			}, {
				no: 2,
				name: "inclusive",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.inclusive = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.version = exports.Experiment_SDKVersionSpecifier.internalBinaryRead(reader, reader.uint32(), options, message.version);
						break;
					case 2:
						message.inclusive = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.version) exports.Experiment_SDKVersionSpecifier.internalBinaryWrite(message.version, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.inclusive !== false) writer.tag(2, runtime_2$6.WireType.Varint).bool(message.inclusive);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.SDKVersionRangeBound
	*/
	exports.Experiment_SDKVersionRangeBound = new Experiment_SDKVersionRangeBound$Type();
	var Experiment_SDKVersionRange$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.SDKVersionRange", [{
				no: 1,
				name: "lower_bound",
				kind: "message",
				T: () => exports.Experiment_SDKVersionRangeBound
			}, {
				no: 2,
				name: "upper_bound",
				kind: "message",
				T: () => exports.Experiment_SDKVersionRangeBound
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.lowerBound = exports.Experiment_SDKVersionRangeBound.internalBinaryRead(reader, reader.uint32(), options, message.lowerBound);
						break;
					case 2:
						message.upperBound = exports.Experiment_SDKVersionRangeBound.internalBinaryRead(reader, reader.uint32(), options, message.upperBound);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.lowerBound) exports.Experiment_SDKVersionRangeBound.internalBinaryWrite(message.lowerBound, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.upperBound) exports.Experiment_SDKVersionRangeBound.internalBinaryWrite(message.upperBound, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.SDKVersionRange
	*/
	exports.Experiment_SDKVersionRange = new Experiment_SDKVersionRange$Type();
	var Experiment_SDKVersion$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.SDKVersion", [{
				no: 1,
				name: "ranges",
				kind: "message",
				repeat: 2,
				T: () => exports.Experiment_SDKVersionRange
			}, {
				no: 2,
				name: "work_around_pyoto_bug",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.ranges = [];
			message.workAroundPyotoBug = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.ranges.push(exports.Experiment_SDKVersionRange.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 2:
						message.workAroundPyotoBug = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.ranges.length; i++) exports.Experiment_SDKVersionRange.internalBinaryWrite(message.ranges[i], writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.workAroundPyotoBug !== false) writer.tag(2, runtime_2$6.WireType.Varint).bool(message.workAroundPyotoBug);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.SDKVersion
	*/
	exports.Experiment_SDKVersion = new Experiment_SDKVersion$Type();
	var Experiment_ClientOperatingSystem$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientOperatingSystem", [
				{
					no: 1,
					name: "ios_version",
					kind: "message",
					T: () => exports.Experiment_SDKVersion
				},
				{
					no: 2,
					name: "android_version",
					kind: "message",
					T: () => exports.Experiment_SDKVersion
				},
				{
					no: 3,
					name: "macos_version",
					kind: "message",
					T: () => exports.Experiment_SDKVersion
				},
				{
					no: 4,
					name: "windows_version",
					kind: "message",
					T: () => exports.Experiment_SDKVersion
				},
				{
					no: 5,
					name: "playstation_version",
					kind: "message",
					T: () => exports.Experiment_SDKVersion
				},
				{
					no: 6,
					name: "xbox_version",
					kind: "message",
					T: () => exports.Experiment_SDKVersion
				},
				{
					no: 7,
					name: "linux_version",
					kind: "message",
					T: () => exports.Experiment_SDKVersion
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.iosVersion = exports.Experiment_SDKVersion.internalBinaryRead(reader, reader.uint32(), options, message.iosVersion);
						break;
					case 2:
						message.androidVersion = exports.Experiment_SDKVersion.internalBinaryRead(reader, reader.uint32(), options, message.androidVersion);
						break;
					case 3:
						message.macosVersion = exports.Experiment_SDKVersion.internalBinaryRead(reader, reader.uint32(), options, message.macosVersion);
						break;
					case 4:
						message.windowsVersion = exports.Experiment_SDKVersion.internalBinaryRead(reader, reader.uint32(), options, message.windowsVersion);
						break;
					case 5:
						message.playstationVersion = exports.Experiment_SDKVersion.internalBinaryRead(reader, reader.uint32(), options, message.playstationVersion);
						break;
					case 6:
						message.xboxVersion = exports.Experiment_SDKVersion.internalBinaryRead(reader, reader.uint32(), options, message.xboxVersion);
						break;
					case 7:
						message.linuxVersion = exports.Experiment_SDKVersion.internalBinaryRead(reader, reader.uint32(), options, message.linuxVersion);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.iosVersion) exports.Experiment_SDKVersion.internalBinaryWrite(message.iosVersion, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.androidVersion) exports.Experiment_SDKVersion.internalBinaryWrite(message.androidVersion, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.macosVersion) exports.Experiment_SDKVersion.internalBinaryWrite(message.macosVersion, writer.tag(3, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.windowsVersion) exports.Experiment_SDKVersion.internalBinaryWrite(message.windowsVersion, writer.tag(4, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.playstationVersion) exports.Experiment_SDKVersion.internalBinaryWrite(message.playstationVersion, writer.tag(5, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.xboxVersion) exports.Experiment_SDKVersion.internalBinaryWrite(message.xboxVersion, writer.tag(6, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.linuxVersion) exports.Experiment_SDKVersion.internalBinaryWrite(message.linuxVersion, writer.tag(7, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientOperatingSystem
	*/
	exports.Experiment_ClientOperatingSystem = new Experiment_ClientOperatingSystem$Type();
	var Experiment_StaffUsers$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.StaffUsers", [{
				no: 1,
				name: "work_accounts",
				kind: "scalar",
				T: 8
			}, {
				no: 2,
				name: "personal_accounts",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.workAccounts = false;
			message.personalAccounts = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.workAccounts = reader.bool();
						break;
					case 2:
						message.personalAccounts = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.workAccounts !== false) writer.tag(1, runtime_2$6.WireType.Varint).bool(message.workAccounts);
			if (message.personalAccounts !== false) writer.tag(2, runtime_2$6.WireType.Varint).bool(message.personalAccounts);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.StaffUsers
	*/
	exports.Experiment_StaffUsers = new Experiment_StaffUsers$Type();
	var Experiment_UserInGuild$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserInGuild", [{
				no: 1,
				name: "guild_ids",
				kind: "scalar",
				repeat: 1,
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.guildIds = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (wireType === runtime_2$6.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.guildIds.push(reader.fixed64().toBigInt());
else message.guildIds.push(reader.fixed64().toBigInt());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.guildIds.length) {
				writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.guildIds.length; i++) writer.fixed64(message.guildIds[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserInGuild
	*/
	exports.Experiment_UserInGuild = new Experiment_UserInGuild$Type();
	var Experiment_UserIds$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserIds", [{
				no: 1,
				name: "user_ids",
				kind: "scalar",
				repeat: 1,
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.userIds = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (wireType === runtime_2$6.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.userIds.push(reader.fixed64().toBigInt());
else message.userIds.push(reader.fixed64().toBigInt());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.userIds.length) {
				writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.userIds.length; i++) writer.fixed64(message.userIds[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserIds
	*/
	exports.Experiment_UserIds = new Experiment_UserIds$Type();
	var Experiment_ClientLocale$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientLocale", [{
				no: 1,
				name: "locales",
				kind: "scalar",
				repeat: 2,
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.locales = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.locales.push(reader.string());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.locales.length; i++) writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.locales[i]);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientLocale
	*/
	exports.Experiment_ClientLocale = new Experiment_ClientLocale$Type();
	var Experiment_ISORegion$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ISORegion", [{
				no: 1,
				name: "iso_country",
				kind: "scalar",
				T: 9
			}, {
				no: 2,
				name: "iso_subdivision",
				kind: "scalar",
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.isoCountry = "";
			message.isoSubdivision = "";
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.isoCountry = reader.string();
						break;
					case 2:
						message.isoSubdivision = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.isoCountry !== "") writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.isoCountry);
			if (message.isoSubdivision !== "") writer.tag(2, runtime_2$6.WireType.LengthDelimited).string(message.isoSubdivision);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ISORegion
	*/
	exports.Experiment_ISORegion = new Experiment_ISORegion$Type();
	var Experiment_Place$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Place", [
				{
					no: 1,
					name: "city",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "subdivision",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "country",
					kind: "scalar",
					T: 9
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.city = "";
			message.subdivision = "";
			message.country = "";
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.city = reader.string();
						break;
					case 2:
						message.subdivision = reader.string();
						break;
					case 3:
						message.country = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.city !== "") writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.city);
			if (message.subdivision !== "") writer.tag(2, runtime_2$6.WireType.LengthDelimited).string(message.subdivision);
			if (message.country !== "") writer.tag(3, runtime_2$6.WireType.LengthDelimited).string(message.country);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Place
	*/
	exports.Experiment_Place = new Experiment_Place$Type();
	var Experiment_Location$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Location", [
				{
					no: 1,
					name: "iso_region",
					kind: "message",
					oneof: "location",
					T: () => exports.Experiment_ISORegion
				},
				{
					no: 2,
					name: "is_eu",
					kind: "scalar",
					oneof: "location",
					T: 8
				},
				{
					no: 3,
					name: "place",
					kind: "message",
					oneof: "location",
					T: () => exports.Experiment_Place
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.location = { oneofKind: undefined };
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.location = {
							oneofKind: "isoRegion",
							isoRegion: exports.Experiment_ISORegion.internalBinaryRead(reader, reader.uint32(), options, message.location.isoRegion)
						};
						break;
					case 2:
						message.location = {
							oneofKind: "isEu",
							isEu: reader.bool()
						};
						break;
					case 3:
						message.location = {
							oneofKind: "place",
							place: exports.Experiment_Place.internalBinaryRead(reader, reader.uint32(), options, message.location.place)
						};
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.location.oneofKind === "isoRegion") exports.Experiment_ISORegion.internalBinaryWrite(message.location.isoRegion, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.location.oneofKind === "isEu") writer.tag(2, runtime_2$6.WireType.Varint).bool(message.location.isEu);
			if (message.location.oneofKind === "place") exports.Experiment_Place.internalBinaryWrite(message.location.place, writer.tag(3, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Location
	*/
	exports.Experiment_Location = new Experiment_Location$Type();
	var Experiment_ClientLocation$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientLocation", [{
				no: 1,
				name: "locations",
				kind: "message",
				repeat: 2,
				T: () => exports.Experiment_Location
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.locations = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.locations.push(exports.Experiment_Location.internalBinaryRead(reader, reader.uint32(), options));
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.locations.length; i++) exports.Experiment_Location.internalBinaryWrite(message.locations[i], writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientLocation
	*/
	exports.Experiment_ClientLocation = new Experiment_ClientLocation$Type();
	var Experiment_ClientIP$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientIP", [{
				no: 1,
				name: "blocks",
				kind: "scalar",
				repeat: 2,
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.blocks = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.blocks.push(reader.string());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.blocks.length; i++) writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.blocks[i]);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientIP
	*/
	exports.Experiment_ClientIP = new Experiment_ClientIP$Type();
	var Experiment_UserLocale$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserLocale", [{
				no: 1,
				name: "locales",
				kind: "scalar",
				repeat: 2,
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.locales = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.locales.push(reader.string());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.locales.length; i++) writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.locales[i]);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserLocale
	*/
	exports.Experiment_UserLocale = new Experiment_UserLocale$Type();
	var Experiment_UserIsBot$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserIsBot", [{
				no: 1,
				name: "is_bot",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.isBot = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.isBot = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.isBot !== false) writer.tag(1, runtime_2$6.WireType.Varint).bool(message.isBot);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserIsBot
	*/
	exports.Experiment_UserIsBot = new Experiment_UserIsBot$Type();
	var Experiment_UserAgeRange$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserAgeRange", [{
				no: 1,
				name: "min_age_years",
				kind: "message",
				T: () => wrappers_2.UInt32Value
			}, {
				no: 2,
				name: "max_age_years",
				kind: "message",
				T: () => wrappers_2.UInt32Value
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.minAgeYears = wrappers_2.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.minAgeYears);
						break;
					case 2:
						message.maxAgeYears = wrappers_2.UInt32Value.internalBinaryRead(reader, reader.uint32(), options, message.maxAgeYears);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.minAgeYears) wrappers_2.UInt32Value.internalBinaryWrite(message.minAgeYears, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.maxAgeYears) wrappers_2.UInt32Value.internalBinaryWrite(message.maxAgeYears, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserAgeRange
	*/
	exports.Experiment_UserAgeRange = new Experiment_UserAgeRange$Type();
	var Experiment_Fixed64Value$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Fixed64Value", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = 0n;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.fixed64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== 0n) writer.tag(1, runtime_2$6.WireType.Bit64).fixed64(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Fixed64Value
	*/
	exports.Experiment_Fixed64Value = new Experiment_Fixed64Value$Type();
	var Experiment_UserIDRange$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserIDRange", [{
				no: 1,
				name: "min_id",
				kind: "message",
				T: () => exports.Experiment_Fixed64Value
			}, {
				no: 2,
				name: "max_id",
				kind: "message",
				T: () => exports.Experiment_Fixed64Value
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.minId = exports.Experiment_Fixed64Value.internalBinaryRead(reader, reader.uint32(), options, message.minId);
						break;
					case 2:
						message.maxId = exports.Experiment_Fixed64Value.internalBinaryRead(reader, reader.uint32(), options, message.maxId);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.minId) exports.Experiment_Fixed64Value.internalBinaryWrite(message.minId, writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.maxId) exports.Experiment_Fixed64Value.internalBinaryWrite(message.maxId, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserIDRange
	*/
	exports.Experiment_UserIDRange = new Experiment_UserIDRange$Type();
	var Experiment_UserHasFlag$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserHasFlag", [{
				no: 1,
				name: "mask",
				kind: "scalar",
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.mask = 0n;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.mask = reader.fixed64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.mask !== 0n) writer.tag(1, runtime_2$6.WireType.Bit64).fixed64(message.mask);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserHasFlag
	*/
	exports.Experiment_UserHasFlag = new Experiment_UserHasFlag$Type();
	var Experiment_UnitIdInRangeByHash$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UnitIdInRangeByHash", [{
				no: 1,
				name: "hash_key",
				kind: "scalar",
				T: 9
			}, {
				no: 2,
				name: "target",
				kind: "scalar",
				T: 13
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.hashKey = "";
			message.target = 0;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.hashKey = reader.string();
						break;
					case 2:
						message.target = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.hashKey !== "") writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.hashKey);
			if (message.target !== 0) writer.tag(2, runtime_2$6.WireType.Varint).uint32(message.target);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UnitIdInRangeByHash
	*/
	exports.Experiment_UnitIdInRangeByHash = new Experiment_UnitIdInRangeByHash$Type();
	var Experiment_ClientReleaseChannel$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientReleaseChannel", [{
				no: 1,
				name: "release_channels",
				kind: "scalar",
				repeat: 2,
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.releaseChannels = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.releaseChannels.push(reader.string());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.releaseChannels.length; i++) writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.releaseChannels[i]);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientReleaseChannel
	*/
	exports.Experiment_ClientReleaseChannel = new Experiment_ClientReleaseChannel$Type();
	var Experiment_Always$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Always", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== false) writer.tag(1, runtime_2$6.WireType.Varint).bool(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Always
	*/
	exports.Experiment_Always = new Experiment_Always$Type();
	var Experiment_ClientSystemLocale$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.ClientSystemLocale", [{
				no: 1,
				name: "locales",
				kind: "scalar",
				repeat: 2,
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.locales = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.locales.push(reader.string());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.locales.length; i++) writer.tag(1, runtime_2$6.WireType.LengthDelimited).string(message.locales[i]);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.ClientSystemLocale
	*/
	exports.Experiment_ClientSystemLocale = new Experiment_ClientSystemLocale$Type();
	var Experiment_UnitIdInExperiment$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UnitIdInExperiment", [{
				no: 1,
				name: "experiment_id",
				kind: "scalar",
				T: 6,
				L: 0
			}, {
				no: 2,
				name: "variation_ids",
				kind: "scalar",
				repeat: 1,
				T: 5
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.experimentId = 0n;
			message.variationIds = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.experimentId = reader.fixed64().toBigInt();
						break;
					case 2:
						if (wireType === runtime_2$6.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.variationIds.push(reader.int32());
else message.variationIds.push(reader.int32());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.experimentId !== 0n) writer.tag(1, runtime_2$6.WireType.Bit64).fixed64(message.experimentId);
			if (message.variationIds.length) {
				writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.variationIds.length; i++) writer.int32(message.variationIds[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UnitIdInExperiment
	*/
	exports.Experiment_UnitIdInExperiment = new Experiment_UnitIdInExperiment$Type();
	var Experiment_UserPremiumType$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.UserPremiumType", [{
				no: 1,
				name: "premium_types",
				kind: "scalar",
				repeat: 1,
				T: 5
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.premiumTypes = [];
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (wireType === runtime_2$6.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.premiumTypes.push(reader.int32());
else message.premiumTypes.push(reader.int32());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.premiumTypes.length) {
				writer.tag(1, runtime_2$6.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.premiumTypes.length; i++) writer.int32(message.premiumTypes[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.UserPremiumType
	*/
	exports.Experiment_UserPremiumType = new Experiment_UserPremiumType$Type();
	var Experiment_Filter$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Filter", [
				{
					no: 2,
					name: "client_version",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_ClientPlatform
				},
				{
					no: 3,
					name: "client_os",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_ClientOperatingSystem
				},
				{
					no: 4,
					name: "staff",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_StaffUsers
				},
				{
					no: 5,
					name: "user_in_guild",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserInGuild
				},
				{
					no: 6,
					name: "user_ids",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserIds
				},
				{
					no: 7,
					name: "client_locale",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_ClientLocale
				},
				{
					no: 8,
					name: "client_location",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_ClientLocation
				},
				{
					no: 9,
					name: "client_ip",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_ClientIP
				},
				{
					no: 10,
					name: "user_locale",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserLocale
				},
				{
					no: 11,
					name: "bot",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserIsBot
				},
				{
					no: 12,
					name: "user_age_range",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserAgeRange
				},
				{
					no: 13,
					name: "user_id_range",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserIDRange
				},
				{
					no: 14,
					name: "user_has_flag",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserHasFlag
				},
				{
					no: 15,
					name: "unit_id_in_range_by_hash",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UnitIdInRangeByHash
				},
				{
					no: 16,
					name: "client_release_channel",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_ClientReleaseChannel
				},
				{
					no: 17,
					name: "always",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_Always
				},
				{
					no: 18,
					name: "client_system_locale",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_ClientSystemLocale
				},
				{
					no: 19,
					name: "unit_id_in_experiment",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UnitIdInExperiment
				},
				{
					no: 20,
					name: "user_premium_type",
					kind: "message",
					oneof: "filter",
					T: () => exports.Experiment_UserPremiumType
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.filter = { oneofKind: undefined };
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 2:
						message.filter = {
							oneofKind: "clientVersion",
							clientVersion: exports.Experiment_ClientPlatform.internalBinaryRead(reader, reader.uint32(), options, message.filter.clientVersion)
						};
						break;
					case 3:
						message.filter = {
							oneofKind: "clientOs",
							clientOs: exports.Experiment_ClientOperatingSystem.internalBinaryRead(reader, reader.uint32(), options, message.filter.clientOs)
						};
						break;
					case 4:
						message.filter = {
							oneofKind: "staff",
							staff: exports.Experiment_StaffUsers.internalBinaryRead(reader, reader.uint32(), options, message.filter.staff)
						};
						break;
					case 5:
						message.filter = {
							oneofKind: "userInGuild",
							userInGuild: exports.Experiment_UserInGuild.internalBinaryRead(reader, reader.uint32(), options, message.filter.userInGuild)
						};
						break;
					case 6:
						message.filter = {
							oneofKind: "userIds",
							userIds: exports.Experiment_UserIds.internalBinaryRead(reader, reader.uint32(), options, message.filter.userIds)
						};
						break;
					case 7:
						message.filter = {
							oneofKind: "clientLocale",
							clientLocale: exports.Experiment_ClientLocale.internalBinaryRead(reader, reader.uint32(), options, message.filter.clientLocale)
						};
						break;
					case 8:
						message.filter = {
							oneofKind: "clientLocation",
							clientLocation: exports.Experiment_ClientLocation.internalBinaryRead(reader, reader.uint32(), options, message.filter.clientLocation)
						};
						break;
					case 9:
						message.filter = {
							oneofKind: "clientIp",
							clientIp: exports.Experiment_ClientIP.internalBinaryRead(reader, reader.uint32(), options, message.filter.clientIp)
						};
						break;
					case 10:
						message.filter = {
							oneofKind: "userLocale",
							userLocale: exports.Experiment_UserLocale.internalBinaryRead(reader, reader.uint32(), options, message.filter.userLocale)
						};
						break;
					case 11:
						message.filter = {
							oneofKind: "bot",
							bot: exports.Experiment_UserIsBot.internalBinaryRead(reader, reader.uint32(), options, message.filter.bot)
						};
						break;
					case 12:
						message.filter = {
							oneofKind: "userAgeRange",
							userAgeRange: exports.Experiment_UserAgeRange.internalBinaryRead(reader, reader.uint32(), options, message.filter.userAgeRange)
						};
						break;
					case 13:
						message.filter = {
							oneofKind: "userIdRange",
							userIdRange: exports.Experiment_UserIDRange.internalBinaryRead(reader, reader.uint32(), options, message.filter.userIdRange)
						};
						break;
					case 14:
						message.filter = {
							oneofKind: "userHasFlag",
							userHasFlag: exports.Experiment_UserHasFlag.internalBinaryRead(reader, reader.uint32(), options, message.filter.userHasFlag)
						};
						break;
					case 15:
						message.filter = {
							oneofKind: "unitIdInRangeByHash",
							unitIdInRangeByHash: exports.Experiment_UnitIdInRangeByHash.internalBinaryRead(reader, reader.uint32(), options, message.filter.unitIdInRangeByHash)
						};
						break;
					case 16:
						message.filter = {
							oneofKind: "clientReleaseChannel",
							clientReleaseChannel: exports.Experiment_ClientReleaseChannel.internalBinaryRead(reader, reader.uint32(), options, message.filter.clientReleaseChannel)
						};
						break;
					case 17:
						message.filter = {
							oneofKind: "always",
							always: exports.Experiment_Always.internalBinaryRead(reader, reader.uint32(), options, message.filter.always)
						};
						break;
					case 18:
						message.filter = {
							oneofKind: "clientSystemLocale",
							clientSystemLocale: exports.Experiment_ClientSystemLocale.internalBinaryRead(reader, reader.uint32(), options, message.filter.clientSystemLocale)
						};
						break;
					case 19:
						message.filter = {
							oneofKind: "unitIdInExperiment",
							unitIdInExperiment: exports.Experiment_UnitIdInExperiment.internalBinaryRead(reader, reader.uint32(), options, message.filter.unitIdInExperiment)
						};
						break;
					case 20:
						message.filter = {
							oneofKind: "userPremiumType",
							userPremiumType: exports.Experiment_UserPremiumType.internalBinaryRead(reader, reader.uint32(), options, message.filter.userPremiumType)
						};
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.filter.oneofKind === "clientVersion") exports.Experiment_ClientPlatform.internalBinaryWrite(message.filter.clientVersion, writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "clientOs") exports.Experiment_ClientOperatingSystem.internalBinaryWrite(message.filter.clientOs, writer.tag(3, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "staff") exports.Experiment_StaffUsers.internalBinaryWrite(message.filter.staff, writer.tag(4, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "userInGuild") exports.Experiment_UserInGuild.internalBinaryWrite(message.filter.userInGuild, writer.tag(5, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "userIds") exports.Experiment_UserIds.internalBinaryWrite(message.filter.userIds, writer.tag(6, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "clientLocale") exports.Experiment_ClientLocale.internalBinaryWrite(message.filter.clientLocale, writer.tag(7, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "clientLocation") exports.Experiment_ClientLocation.internalBinaryWrite(message.filter.clientLocation, writer.tag(8, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "clientIp") exports.Experiment_ClientIP.internalBinaryWrite(message.filter.clientIp, writer.tag(9, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "userLocale") exports.Experiment_UserLocale.internalBinaryWrite(message.filter.userLocale, writer.tag(10, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "bot") exports.Experiment_UserIsBot.internalBinaryWrite(message.filter.bot, writer.tag(11, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "userAgeRange") exports.Experiment_UserAgeRange.internalBinaryWrite(message.filter.userAgeRange, writer.tag(12, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "userIdRange") exports.Experiment_UserIDRange.internalBinaryWrite(message.filter.userIdRange, writer.tag(13, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "userHasFlag") exports.Experiment_UserHasFlag.internalBinaryWrite(message.filter.userHasFlag, writer.tag(14, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "unitIdInRangeByHash") exports.Experiment_UnitIdInRangeByHash.internalBinaryWrite(message.filter.unitIdInRangeByHash, writer.tag(15, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "clientReleaseChannel") exports.Experiment_ClientReleaseChannel.internalBinaryWrite(message.filter.clientReleaseChannel, writer.tag(16, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "always") exports.Experiment_Always.internalBinaryWrite(message.filter.always, writer.tag(17, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "clientSystemLocale") exports.Experiment_ClientSystemLocale.internalBinaryWrite(message.filter.clientSystemLocale, writer.tag(18, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "unitIdInExperiment") exports.Experiment_UnitIdInExperiment.internalBinaryWrite(message.filter.unitIdInExperiment, writer.tag(19, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.filter.oneofKind === "userPremiumType") exports.Experiment_UserPremiumType.internalBinaryWrite(message.filter.userPremiumType, writer.tag(20, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Filter
	*/
	exports.Experiment_Filter = new Experiment_Filter$Type();
	var Experiment_Override$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Override", [{
				no: 1,
				name: "variation_id",
				kind: "scalar",
				T: 5
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.variationId = 0;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.variationId = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.variationId !== 0) writer.tag(1, runtime_2$6.WireType.Varint).int32(message.variationId);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Override
	*/
	exports.Experiment_Override = new Experiment_Override$Type();
	var Experiment_Rule$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.Rule", [
				{
					no: 1,
					name: "type",
					kind: "enum",
					T: () => [
						"discord_protos.discord_experimentation.v1.Experiment.Type",
						Experiment_Type,
						"TYPE_"
					]
				},
				{
					no: 2,
					name: "filters",
					kind: "message",
					repeat: 2,
					T: () => exports.Experiment_Filter
				},
				{
					no: 3,
					name: "override",
					kind: "message",
					T: () => exports.Experiment_Override
				},
				{
					no: 4,
					name: "is_sunset_rule",
					kind: "scalar",
					T: 8
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.type = 0;
			message.filters = [];
			message.isSunsetRule = false;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.type = reader.int32();
						break;
					case 2:
						message.filters.push(exports.Experiment_Filter.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 3:
						message.override = exports.Experiment_Override.internalBinaryRead(reader, reader.uint32(), options, message.override);
						break;
					case 4:
						message.isSunsetRule = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.type !== 0) writer.tag(1, runtime_2$6.WireType.Varint).int32(message.type);
			for (let i = 0; i < message.filters.length; i++) exports.Experiment_Filter.internalBinaryWrite(message.filters[i], writer.tag(2, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.override) exports.Experiment_Override.internalBinaryWrite(message.override, writer.tag(3, runtime_2$6.WireType.LengthDelimited).fork(), options).join();
			if (message.isSunsetRule !== false) writer.tag(4, runtime_2$6.WireType.Varint).bool(message.isSunsetRule);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.Rule
	*/
	exports.Experiment_Rule = new Experiment_Rule$Type();
	var Experiment_DebugConfig$Type = class extends runtime_4$6.MessageType {
		constructor() {
			super("discord_protos.discord_experimentation.v1.Experiment.DebugConfig", [
				{
					no: 1,
					name: "enable_decision_logging",
					kind: "scalar",
					T: 8
				},
				{
					no: 2,
					name: "metrics_sample_rate",
					kind: "scalar",
					T: 1
				},
				{
					no: 3,
					name: "log_context_on_failure",
					kind: "scalar",
					T: 8
				},
				{
					no: 4,
					name: "log_raw_headers",
					kind: "scalar",
					T: 8
				},
				{
					no: 5,
					name: "tag_filter_metrics",
					kind: "scalar",
					T: 8
				},
				{
					no: 6,
					name: "decision_log_sample_rate",
					kind: "scalar",
					T: 1
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.enableDecisionLogging = false;
			message.metricsSampleRate = 0;
			message.logContextOnFailure = false;
			message.logRawHeaders = false;
			message.tagFilterMetrics = false;
			message.decisionLogSampleRate = 0;
			if (value !== undefined) (0, runtime_3$6.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.enableDecisionLogging = reader.bool();
						break;
					case 2:
						message.metricsSampleRate = reader.double();
						break;
					case 3:
						message.logContextOnFailure = reader.bool();
						break;
					case 4:
						message.logRawHeaders = reader.bool();
						break;
					case 5:
						message.tagFilterMetrics = reader.bool();
						break;
					case 6:
						message.decisionLogSampleRate = reader.double();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_1$7.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.enableDecisionLogging !== false) writer.tag(1, runtime_2$6.WireType.Varint).bool(message.enableDecisionLogging);
			if (message.metricsSampleRate !== 0) writer.tag(2, runtime_2$6.WireType.Bit64).double(message.metricsSampleRate);
			if (message.logContextOnFailure !== false) writer.tag(3, runtime_2$6.WireType.Varint).bool(message.logContextOnFailure);
			if (message.logRawHeaders !== false) writer.tag(4, runtime_2$6.WireType.Varint).bool(message.logRawHeaders);
			if (message.tagFilterMetrics !== false) writer.tag(5, runtime_2$6.WireType.Varint).bool(message.tagFilterMetrics);
			if (message.decisionLogSampleRate !== 0) writer.tag(6, runtime_2$6.WireType.Bit64).double(message.decisionLogSampleRate);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_1$7.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_experimentation.v1.Experiment.DebugConfig
	*/
	exports.Experiment_DebugConfig = new Experiment_DebugConfig$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_kkv_store_value_models/v1/ApplicationUserRoleConnection.js
var require_ApplicationUserRoleConnection = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_kkv_store_value_models/v1/ApplicationUserRoleConnection.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.ApplicationUserRoleConnection = void 0;
	const runtime_1$6 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$5 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$5 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$5 = (init_es2015(), __toCommonJS(es2015_exports));
	var ApplicationUserRoleConnection$Type = class extends runtime_4$5.MessageType {
		constructor() {
			super("discord_protos.discord_kkv_store_value_models.v1.ApplicationUserRoleConnection", [
				{
					no: 1,
					name: "metadata",
					kind: "map",
					K: 9,
					V: {
						kind: "scalar",
						T: 9
					}
				},
				{
					no: 2,
					name: "platform_name",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "platform_username",
					kind: "scalar",
					T: 9
				},
				{
					no: 4,
					name: "version",
					kind: "scalar",
					T: 6,
					L: 0
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.metadata = {};
			message.platformName = "";
			message.platformUsername = "";
			message.version = 0n;
			if (value !== undefined) (0, runtime_3$5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.metadata, reader, options);
						break;
					case 2:
						message.platformName = reader.string();
						break;
					case 3:
						message.platformUsername = reader.string();
						break;
					case 4:
						message.version = reader.fixed64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$5.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = reader.string();
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_kkv_store_value_models.v1.ApplicationUserRoleConnection.metadata");
				}
			}
			map[key ?? ""] = val ?? "";
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.metadata)) writer.tag(1, runtime_1$6.WireType.LengthDelimited).fork().tag(1, runtime_1$6.WireType.LengthDelimited).string(k).tag(2, runtime_1$6.WireType.LengthDelimited).string(message.metadata[k]).join();
			if (message.platformName !== "") writer.tag(2, runtime_1$6.WireType.LengthDelimited).string(message.platformName);
			if (message.platformUsername !== "") writer.tag(3, runtime_1$6.WireType.LengthDelimited).string(message.platformUsername);
			if (message.version !== 0n) writer.tag(4, runtime_1$6.WireType.Bit64).fixed64(message.version);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$5.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_kkv_store_value_models.v1.ApplicationUserRoleConnection
	*/
	exports.ApplicationUserRoleConnection = new ApplicationUserRoleConnection$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_kkv_store_value_models/v1/AcknowledgedApplicationDisclosures.js
var require_AcknowledgedApplicationDisclosures = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_kkv_store_value_models/v1/AcknowledgedApplicationDisclosures.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.AcknowledgedApplicationDisclosures_AcknowledgedApplicationDisclosure = exports.AcknowledgedApplicationDisclosures = exports.AcknowledgedApplicationDisclosures_ApplicationDisclosureType = void 0;
	const runtime_1$5 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$4 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$4 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$4 = (init_es2015(), __toCommonJS(es2015_exports));
	const timestamp_1 = require_timestamp();
	/**
	* @generated from protobuf enum discord_protos.discord_kkv_store_value_models.v1.AcknowledgedApplicationDisclosures.ApplicationDisclosureType
	*/
	var AcknowledgedApplicationDisclosures_ApplicationDisclosureType;
	(function(AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1) {
		/**
		* @generated from protobuf enum value: APPLICATION_DISCLOSURE_TYPE_UNSPECIFIED_DISCLOSURE = 0;
		*/
		AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1[AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1["UNSPECIFIED_DISCLOSURE"] = 0] = "UNSPECIFIED_DISCLOSURE";
		/**
		* @generated from protobuf enum value: APPLICATION_DISCLOSURE_TYPE_IP_LOCATION = 1;
		*/
		AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1[AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1["IP_LOCATION"] = 1] = "IP_LOCATION";
		/**
		* @generated from protobuf enum value: APPLICATION_DISCLOSURE_TYPE_DISPLAYS_ADVERTISEMENTS = 2;
		*/
		AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1[AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1["DISPLAYS_ADVERTISEMENTS"] = 2] = "DISPLAYS_ADVERTISEMENTS";
		/**
		* @generated from protobuf enum value: APPLICATION_DISCLOSURE_TYPE_PARTNER_SDK_DATA_SHARING_MESSAGE = 3;
		*/
		AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1[AcknowledgedApplicationDisclosures_ApplicationDisclosureType$1["PARTNER_SDK_DATA_SHARING_MESSAGE"] = 3] = "PARTNER_SDK_DATA_SHARING_MESSAGE";
	})(AcknowledgedApplicationDisclosures_ApplicationDisclosureType || (exports.AcknowledgedApplicationDisclosures_ApplicationDisclosureType = AcknowledgedApplicationDisclosures_ApplicationDisclosureType = {}));
	var AcknowledgedApplicationDisclosures$Type = class extends runtime_4$4.MessageType {
		constructor() {
			super("discord_protos.discord_kkv_store_value_models.v1.AcknowledgedApplicationDisclosures", [{
				no: 1,
				name: "acked_disclosures",
				kind: "message",
				repeat: 2,
				T: () => exports.AcknowledgedApplicationDisclosures_AcknowledgedApplicationDisclosure
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.ackedDisclosures = [];
			if (value !== undefined) (0, runtime_3$4.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.ackedDisclosures.push(exports.AcknowledgedApplicationDisclosures_AcknowledgedApplicationDisclosure.internalBinaryRead(reader, reader.uint32(), options));
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.ackedDisclosures.length; i++) exports.AcknowledgedApplicationDisclosures_AcknowledgedApplicationDisclosure.internalBinaryWrite(message.ackedDisclosures[i], writer.tag(1, runtime_1$5.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_kkv_store_value_models.v1.AcknowledgedApplicationDisclosures
	*/
	exports.AcknowledgedApplicationDisclosures = new AcknowledgedApplicationDisclosures$Type();
	var AcknowledgedApplicationDisclosures_AcknowledgedApplicationDisclosure$Type = class extends runtime_4$4.MessageType {
		constructor() {
			super("discord_protos.discord_kkv_store_value_models.v1.AcknowledgedApplicationDisclosures.AcknowledgedApplicationDisclosure", [{
				no: 1,
				name: "disclosure_type",
				kind: "enum",
				T: () => [
					"discord_protos.discord_kkv_store_value_models.v1.AcknowledgedApplicationDisclosures.ApplicationDisclosureType",
					AcknowledgedApplicationDisclosures_ApplicationDisclosureType,
					"APPLICATION_DISCLOSURE_TYPE_"
				]
			}, {
				no: 2,
				name: "acked_at",
				kind: "message",
				T: () => timestamp_1.Timestamp
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.disclosureType = 0;
			if (value !== undefined) (0, runtime_3$4.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.disclosureType = reader.int32();
						break;
					case 2:
						message.ackedAt = timestamp_1.Timestamp.internalBinaryRead(reader, reader.uint32(), options, message.ackedAt);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.disclosureType !== 0) writer.tag(1, runtime_1$5.WireType.Varint).int32(message.disclosureType);
			if (message.ackedAt) timestamp_1.Timestamp.internalBinaryWrite(message.ackedAt, writer.tag(2, runtime_1$5.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_kkv_store_value_models.v1.AcknowledgedApplicationDisclosures.AcknowledgedApplicationDisclosure
	*/
	exports.AcknowledgedApplicationDisclosures_AcknowledgedApplicationDisclosure = new AcknowledgedApplicationDisclosures_AcknowledgedApplicationDisclosure$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/premium_marketing/v1/PremiumMarketingComponentProperties.js
var require_PremiumMarketingComponentProperties = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/premium_marketing/v1/PremiumMarketingComponentProperties.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.PremiumMarketingComponentProperties_MobileBottomSheet = exports.PremiumMarketingComponentProperties_CTAButton = exports.PremiumMarketingComponentProperties_PaymentModalBanner = exports.PremiumMarketingComponentProperties_MarketingPageBanner = exports.PremiumMarketingComponentProperties_PremiumTab = exports.PremiumMarketingComponentProperties_AnnouncementModalVariant1Properties = exports.PremiumMarketingComponentProperties_Variant1Storage = exports.PremiumMarketingComponentProperties_Subtitle = exports.PremiumMarketingComponentProperties_SubscriptionButton = exports.PremiumMarketingComponentProperties_FeatureCard = exports.PremiumMarketingComponentProperties = exports.PremiumMarketingComponentProperties_ButtonAction = void 0;
	const runtime_1$4 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$3 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$3 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$3 = (init_es2015(), __toCommonJS(es2015_exports));
	/**
	* @generated from protobuf enum discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.ButtonAction
	*/
	var PremiumMarketingComponentProperties_ButtonAction;
	(function(PremiumMarketingComponentProperties_ButtonAction$1) {
		/**
		* @generated from protobuf enum value: BUTTON_ACTION_UNSPECIFIED = 0;
		*/
		PremiumMarketingComponentProperties_ButtonAction$1[PremiumMarketingComponentProperties_ButtonAction$1["UNSPECIFIED"] = 0] = "UNSPECIFIED";
		/**
		* @generated from protobuf enum value: BUTTON_ACTION_OPEN_MARKETING_PAGE = 1;
		*/
		PremiumMarketingComponentProperties_ButtonAction$1[PremiumMarketingComponentProperties_ButtonAction$1["OPEN_MARKETING_PAGE"] = 1] = "OPEN_MARKETING_PAGE";
		/**
		* @generated from protobuf enum value: BUTTON_ACTION_OPEN_TIER_2_PAYMENT_MODAL = 2;
		*/
		PremiumMarketingComponentProperties_ButtonAction$1[PremiumMarketingComponentProperties_ButtonAction$1["OPEN_TIER_2_PAYMENT_MODAL"] = 2] = "OPEN_TIER_2_PAYMENT_MODAL";
		/**
		* @generated from protobuf enum value: BUTTON_ACTION_OPEN_TIER_1_PAYMENT_MODAL = 3;
		*/
		PremiumMarketingComponentProperties_ButtonAction$1[PremiumMarketingComponentProperties_ButtonAction$1["OPEN_TIER_1_PAYMENT_MODAL"] = 3] = "OPEN_TIER_1_PAYMENT_MODAL";
		/**
		* @generated from protobuf enum value: BUTTON_ACTION_OPEN_TIER_2_PAYMENT_MODAL_CUSTOM_CONFIRMATION_FOOTER = 4;
		*/
		PremiumMarketingComponentProperties_ButtonAction$1[PremiumMarketingComponentProperties_ButtonAction$1["OPEN_TIER_2_PAYMENT_MODAL_CUSTOM_CONFIRMATION_FOOTER"] = 4] = "OPEN_TIER_2_PAYMENT_MODAL_CUSTOM_CONFIRMATION_FOOTER";
	})(PremiumMarketingComponentProperties_ButtonAction || (exports.PremiumMarketingComponentProperties_ButtonAction = PremiumMarketingComponentProperties_ButtonAction = {}));
	var PremiumMarketingComponentProperties$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties", [
				{
					no: 3,
					name: "content_identifier",
					kind: "scalar",
					T: 9
				},
				{
					no: 1,
					name: "placeholder",
					kind: "scalar",
					oneof: "properties",
					T: 9
				},
				{
					no: 2,
					name: "announcement_modal_variant_1",
					kind: "message",
					oneof: "properties",
					T: () => exports.PremiumMarketingComponentProperties_AnnouncementModalVariant1Properties
				},
				{
					no: 4,
					name: "premium_tab",
					kind: "message",
					oneof: "properties",
					T: () => exports.PremiumMarketingComponentProperties_PremiumTab
				},
				{
					no: 5,
					name: "marketing_page_banner",
					kind: "message",
					oneof: "properties",
					T: () => exports.PremiumMarketingComponentProperties_MarketingPageBanner
				},
				{
					no: 6,
					name: "payment_modal_banner",
					kind: "message",
					oneof: "properties",
					T: () => exports.PremiumMarketingComponentProperties_PaymentModalBanner
				},
				{
					no: 7,
					name: "mobile_bottom_sheet",
					kind: "message",
					oneof: "properties",
					T: () => exports.PremiumMarketingComponentProperties_MobileBottomSheet
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.contentIdentifier = "";
			message.properties = { oneofKind: undefined };
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 3:
						message.contentIdentifier = reader.string();
						break;
					case 1:
						message.properties = {
							oneofKind: "placeholder",
							placeholder: reader.string()
						};
						break;
					case 2:
						message.properties = {
							oneofKind: "announcementModalVariant1",
							announcementModalVariant1: exports.PremiumMarketingComponentProperties_AnnouncementModalVariant1Properties.internalBinaryRead(reader, reader.uint32(), options, message.properties.announcementModalVariant1)
						};
						break;
					case 4:
						message.properties = {
							oneofKind: "premiumTab",
							premiumTab: exports.PremiumMarketingComponentProperties_PremiumTab.internalBinaryRead(reader, reader.uint32(), options, message.properties.premiumTab)
						};
						break;
					case 5:
						message.properties = {
							oneofKind: "marketingPageBanner",
							marketingPageBanner: exports.PremiumMarketingComponentProperties_MarketingPageBanner.internalBinaryRead(reader, reader.uint32(), options, message.properties.marketingPageBanner)
						};
						break;
					case 6:
						message.properties = {
							oneofKind: "paymentModalBanner",
							paymentModalBanner: exports.PremiumMarketingComponentProperties_PaymentModalBanner.internalBinaryRead(reader, reader.uint32(), options, message.properties.paymentModalBanner)
						};
						break;
					case 7:
						message.properties = {
							oneofKind: "mobileBottomSheet",
							mobileBottomSheet: exports.PremiumMarketingComponentProperties_MobileBottomSheet.internalBinaryRead(reader, reader.uint32(), options, message.properties.mobileBottomSheet)
						};
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.properties.oneofKind === "placeholder") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.properties.placeholder);
			if (message.properties.oneofKind === "announcementModalVariant1") exports.PremiumMarketingComponentProperties_AnnouncementModalVariant1Properties.internalBinaryWrite(message.properties.announcementModalVariant1, writer.tag(2, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			if (message.contentIdentifier !== "") writer.tag(3, runtime_1$4.WireType.LengthDelimited).string(message.contentIdentifier);
			if (message.properties.oneofKind === "premiumTab") exports.PremiumMarketingComponentProperties_PremiumTab.internalBinaryWrite(message.properties.premiumTab, writer.tag(4, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			if (message.properties.oneofKind === "marketingPageBanner") exports.PremiumMarketingComponentProperties_MarketingPageBanner.internalBinaryWrite(message.properties.marketingPageBanner, writer.tag(5, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			if (message.properties.oneofKind === "paymentModalBanner") exports.PremiumMarketingComponentProperties_PaymentModalBanner.internalBinaryWrite(message.properties.paymentModalBanner, writer.tag(6, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			if (message.properties.oneofKind === "mobileBottomSheet") exports.PremiumMarketingComponentProperties_MobileBottomSheet.internalBinaryWrite(message.properties.mobileBottomSheet, writer.tag(7, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties
	*/
	exports.PremiumMarketingComponentProperties = new PremiumMarketingComponentProperties$Type();
	var PremiumMarketingComponentProperties_FeatureCard$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.FeatureCard", [
				{
					no: 1,
					name: "header",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "pill",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "body",
					kind: "scalar",
					T: 9
				},
				{
					no: 4,
					name: "image_link",
					kind: "scalar",
					T: 9
				},
				{
					no: 5,
					name: "image_link_light_theme",
					kind: "scalar",
					T: 9
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.header = "";
			message.pill = "";
			message.body = "";
			message.imageLink = "";
			message.imageLinkLightTheme = "";
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.header = reader.string();
						break;
					case 2:
						message.pill = reader.string();
						break;
					case 3:
						message.body = reader.string();
						break;
					case 4:
						message.imageLink = reader.string();
						break;
					case 5:
						message.imageLinkLightTheme = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.header !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.header);
			if (message.pill !== "") writer.tag(2, runtime_1$4.WireType.LengthDelimited).string(message.pill);
			if (message.body !== "") writer.tag(3, runtime_1$4.WireType.LengthDelimited).string(message.body);
			if (message.imageLink !== "") writer.tag(4, runtime_1$4.WireType.LengthDelimited).string(message.imageLink);
			if (message.imageLinkLightTheme !== "") writer.tag(5, runtime_1$4.WireType.LengthDelimited).string(message.imageLinkLightTheme);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.FeatureCard
	*/
	exports.PremiumMarketingComponentProperties_FeatureCard = new PremiumMarketingComponentProperties_FeatureCard$Type();
	var PremiumMarketingComponentProperties_SubscriptionButton$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.SubscriptionButton", [{
				no: 1,
				name: "copy",
				kind: "scalar",
				T: 9
			}, {
				no: 2,
				name: "button_action",
				kind: "enum",
				T: () => [
					"discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.ButtonAction",
					PremiumMarketingComponentProperties_ButtonAction,
					"BUTTON_ACTION_"
				]
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.copy = "";
			message.buttonAction = 0;
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.copy = reader.string();
						break;
					case 2:
						message.buttonAction = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.copy !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.copy);
			if (message.buttonAction !== 0) writer.tag(2, runtime_1$4.WireType.Varint).int32(message.buttonAction);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.SubscriptionButton
	*/
	exports.PremiumMarketingComponentProperties_SubscriptionButton = new PremiumMarketingComponentProperties_SubscriptionButton$Type();
	var PremiumMarketingComponentProperties_Subtitle$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.Subtitle", [
				{
					no: 1,
					name: "link",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "locale",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "is_default",
					kind: "scalar",
					T: 8
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.link = "";
			message.locale = "";
			message.isDefault = false;
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.link = reader.string();
						break;
					case 2:
						message.locale = reader.string();
						break;
					case 3:
						message.isDefault = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.link !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.link);
			if (message.locale !== "") writer.tag(2, runtime_1$4.WireType.LengthDelimited).string(message.locale);
			if (message.isDefault !== false) writer.tag(3, runtime_1$4.WireType.Varint).bool(message.isDefault);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.Subtitle
	*/
	exports.PremiumMarketingComponentProperties_Subtitle = new PremiumMarketingComponentProperties_Subtitle$Type();
	var PremiumMarketingComponentProperties_Variant1Storage$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.Variant1Storage", [
				{
					no: 1,
					name: "hero_art_localized_video_links_dark_theme",
					kind: "map",
					K: 9,
					V: {
						kind: "scalar",
						T: 9
					}
				},
				{
					no: 2,
					name: "hero_art_localized_video_links_light_theme",
					kind: "map",
					K: 9,
					V: {
						kind: "scalar",
						T: 9
					}
				},
				{
					no: 3,
					name: "hero_art_video_subtitle_links",
					kind: "map",
					K: 9,
					V: {
						kind: "scalar",
						T: 9
					}
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.heroArtLocalizedVideoLinksDarkTheme = {};
			message.heroArtLocalizedVideoLinksLightTheme = {};
			message.heroArtVideoSubtitleLinks = {};
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.heroArtLocalizedVideoLinksDarkTheme, reader, options);
						break;
					case 2:
						this.binaryReadMap2(message.heroArtLocalizedVideoLinksLightTheme, reader, options);
						break;
					case 3:
						this.binaryReadMap3(message.heroArtVideoSubtitleLinks, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = reader.string();
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.Variant1Storage.hero_art_localized_video_links_dark_theme");
				}
			}
			map[key ?? ""] = val ?? "";
		}
		binaryReadMap2(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = reader.string();
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.Variant1Storage.hero_art_localized_video_links_light_theme");
				}
			}
			map[key ?? ""] = val ?? "";
		}
		binaryReadMap3(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = reader.string();
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.Variant1Storage.hero_art_video_subtitle_links");
				}
			}
			map[key ?? ""] = val ?? "";
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.heroArtLocalizedVideoLinksDarkTheme)) writer.tag(1, runtime_1$4.WireType.LengthDelimited).fork().tag(1, runtime_1$4.WireType.LengthDelimited).string(k).tag(2, runtime_1$4.WireType.LengthDelimited).string(message.heroArtLocalizedVideoLinksDarkTheme[k]).join();
			for (let k of globalThis.Object.keys(message.heroArtLocalizedVideoLinksLightTheme)) writer.tag(2, runtime_1$4.WireType.LengthDelimited).fork().tag(1, runtime_1$4.WireType.LengthDelimited).string(k).tag(2, runtime_1$4.WireType.LengthDelimited).string(message.heroArtLocalizedVideoLinksLightTheme[k]).join();
			for (let k of globalThis.Object.keys(message.heroArtVideoSubtitleLinks)) writer.tag(3, runtime_1$4.WireType.LengthDelimited).fork().tag(1, runtime_1$4.WireType.LengthDelimited).string(k).tag(2, runtime_1$4.WireType.LengthDelimited).string(message.heroArtVideoSubtitleLinks[k]).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.Variant1Storage
	*/
	exports.PremiumMarketingComponentProperties_Variant1Storage = new PremiumMarketingComponentProperties_Variant1Storage$Type();
	var PremiumMarketingComponentProperties_AnnouncementModalVariant1Properties$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.AnnouncementModalVariant1Properties", [
				{
					no: 1,
					name: "header",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "subheader",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "video_link",
					kind: "scalar",
					T: 9
				},
				{
					no: 4,
					name: "help_article_id",
					kind: "scalar",
					T: 9
				},
				{
					no: 5,
					name: "feature_cards",
					kind: "message",
					repeat: 2,
					T: () => exports.PremiumMarketingComponentProperties_FeatureCard
				},
				{
					no: 6,
					name: "button",
					kind: "message",
					T: () => exports.PremiumMarketingComponentProperties_SubscriptionButton
				},
				{
					no: 7,
					name: "dismiss_key",
					kind: "scalar",
					T: 9
				},
				{
					no: 8,
					name: "hero_art_video_link_light_theme",
					kind: "scalar",
					T: 9
				},
				{
					no: 9,
					name: "hero_art_image_link_dark_theme",
					kind: "scalar",
					T: 9
				},
				{
					no: 10,
					name: "hero_art_image_link_light_theme",
					kind: "scalar",
					T: 9
				},
				{
					no: 11,
					name: "modal_top_pill",
					kind: "scalar",
					T: 9
				},
				{
					no: 12,
					name: "body",
					kind: "scalar",
					T: 9
				},
				{
					no: 13,
					name: "hero_art_video_subtitles",
					kind: "message",
					repeat: 2,
					T: () => exports.PremiumMarketingComponentProperties_Subtitle
				},
				{
					no: 14,
					name: "storage",
					kind: "message",
					T: () => exports.PremiumMarketingComponentProperties_Variant1Storage
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.header = "";
			message.subheader = "";
			message.videoLink = "";
			message.helpArticleId = "";
			message.featureCards = [];
			message.dismissKey = "";
			message.heroArtVideoLinkLightTheme = "";
			message.heroArtImageLinkDarkTheme = "";
			message.heroArtImageLinkLightTheme = "";
			message.modalTopPill = "";
			message.body = "";
			message.heroArtVideoSubtitles = [];
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.header = reader.string();
						break;
					case 2:
						message.subheader = reader.string();
						break;
					case 3:
						message.videoLink = reader.string();
						break;
					case 4:
						message.helpArticleId = reader.string();
						break;
					case 5:
						message.featureCards.push(exports.PremiumMarketingComponentProperties_FeatureCard.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 6:
						message.button = exports.PremiumMarketingComponentProperties_SubscriptionButton.internalBinaryRead(reader, reader.uint32(), options, message.button);
						break;
					case 7:
						message.dismissKey = reader.string();
						break;
					case 8:
						message.heroArtVideoLinkLightTheme = reader.string();
						break;
					case 9:
						message.heroArtImageLinkDarkTheme = reader.string();
						break;
					case 10:
						message.heroArtImageLinkLightTheme = reader.string();
						break;
					case 11:
						message.modalTopPill = reader.string();
						break;
					case 12:
						message.body = reader.string();
						break;
					case 13:
						message.heroArtVideoSubtitles.push(exports.PremiumMarketingComponentProperties_Subtitle.internalBinaryRead(reader, reader.uint32(), options));
						break;
					case 14:
						message.storage = exports.PremiumMarketingComponentProperties_Variant1Storage.internalBinaryRead(reader, reader.uint32(), options, message.storage);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.header !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.header);
			if (message.subheader !== "") writer.tag(2, runtime_1$4.WireType.LengthDelimited).string(message.subheader);
			if (message.videoLink !== "") writer.tag(3, runtime_1$4.WireType.LengthDelimited).string(message.videoLink);
			if (message.helpArticleId !== "") writer.tag(4, runtime_1$4.WireType.LengthDelimited).string(message.helpArticleId);
			for (let i = 0; i < message.featureCards.length; i++) exports.PremiumMarketingComponentProperties_FeatureCard.internalBinaryWrite(message.featureCards[i], writer.tag(5, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			if (message.button) exports.PremiumMarketingComponentProperties_SubscriptionButton.internalBinaryWrite(message.button, writer.tag(6, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			if (message.dismissKey !== "") writer.tag(7, runtime_1$4.WireType.LengthDelimited).string(message.dismissKey);
			if (message.heroArtVideoLinkLightTheme !== "") writer.tag(8, runtime_1$4.WireType.LengthDelimited).string(message.heroArtVideoLinkLightTheme);
			if (message.heroArtImageLinkDarkTheme !== "") writer.tag(9, runtime_1$4.WireType.LengthDelimited).string(message.heroArtImageLinkDarkTheme);
			if (message.heroArtImageLinkLightTheme !== "") writer.tag(10, runtime_1$4.WireType.LengthDelimited).string(message.heroArtImageLinkLightTheme);
			if (message.modalTopPill !== "") writer.tag(11, runtime_1$4.WireType.LengthDelimited).string(message.modalTopPill);
			if (message.body !== "") writer.tag(12, runtime_1$4.WireType.LengthDelimited).string(message.body);
			for (let i = 0; i < message.heroArtVideoSubtitles.length; i++) exports.PremiumMarketingComponentProperties_Subtitle.internalBinaryWrite(message.heroArtVideoSubtitles[i], writer.tag(13, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			if (message.storage) exports.PremiumMarketingComponentProperties_Variant1Storage.internalBinaryWrite(message.storage, writer.tag(14, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.AnnouncementModalVariant1Properties
	*/
	exports.PremiumMarketingComponentProperties_AnnouncementModalVariant1Properties = new PremiumMarketingComponentProperties_AnnouncementModalVariant1Properties$Type();
	var PremiumMarketingComponentProperties_PremiumTab$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.PremiumTab", [{
				no: 1,
				name: "badge_label",
				kind: "scalar",
				T: 9
			}, {
				no: 2,
				name: "acknowledged_badge_label",
				kind: "scalar",
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.badgeLabel = "";
			message.acknowledgedBadgeLabel = "";
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.badgeLabel = reader.string();
						break;
					case 2:
						message.acknowledgedBadgeLabel = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.badgeLabel !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.badgeLabel);
			if (message.acknowledgedBadgeLabel !== "") writer.tag(2, runtime_1$4.WireType.LengthDelimited).string(message.acknowledgedBadgeLabel);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.PremiumTab
	*/
	exports.PremiumMarketingComponentProperties_PremiumTab = new PremiumMarketingComponentProperties_PremiumTab$Type();
	var PremiumMarketingComponentProperties_MarketingPageBanner$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.MarketingPageBanner", [
				{
					no: 1,
					name: "asset_url",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "header",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "body",
					kind: "scalar",
					T: 9
				},
				{
					no: 4,
					name: "help_article_id",
					kind: "scalar",
					T: 9
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.assetUrl = "";
			message.header = "";
			message.body = "";
			message.helpArticleId = "";
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.assetUrl = reader.string();
						break;
					case 2:
						message.header = reader.string();
						break;
					case 3:
						message.body = reader.string();
						break;
					case 4:
						message.helpArticleId = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.assetUrl !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.assetUrl);
			if (message.header !== "") writer.tag(2, runtime_1$4.WireType.LengthDelimited).string(message.header);
			if (message.body !== "") writer.tag(3, runtime_1$4.WireType.LengthDelimited).string(message.body);
			if (message.helpArticleId !== "") writer.tag(4, runtime_1$4.WireType.LengthDelimited).string(message.helpArticleId);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.MarketingPageBanner
	*/
	exports.PremiumMarketingComponentProperties_MarketingPageBanner = new PremiumMarketingComponentProperties_MarketingPageBanner$Type();
	var PremiumMarketingComponentProperties_PaymentModalBanner$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.PaymentModalBanner", [
				{
					no: 1,
					name: "asset_url",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "header",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "body",
					kind: "scalar",
					T: 9
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.assetUrl = "";
			message.header = "";
			message.body = "";
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.assetUrl = reader.string();
						break;
					case 2:
						message.header = reader.string();
						break;
					case 3:
						message.body = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.assetUrl !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.assetUrl);
			if (message.header !== "") writer.tag(2, runtime_1$4.WireType.LengthDelimited).string(message.header);
			if (message.body !== "") writer.tag(3, runtime_1$4.WireType.LengthDelimited).string(message.body);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.PaymentModalBanner
	*/
	exports.PremiumMarketingComponentProperties_PaymentModalBanner = new PremiumMarketingComponentProperties_PaymentModalBanner$Type();
	var PremiumMarketingComponentProperties_CTAButton$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.CTAButton", [{
				no: 1,
				name: "copy",
				kind: "scalar",
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.copy = "";
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.copy = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.copy !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.copy);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.CTAButton
	*/
	exports.PremiumMarketingComponentProperties_CTAButton = new PremiumMarketingComponentProperties_CTAButton$Type();
	var PremiumMarketingComponentProperties_MobileBottomSheet$Type = class extends runtime_4$3.MessageType {
		constructor() {
			super("discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.MobileBottomSheet", [
				{
					no: 1,
					name: "asset_url",
					kind: "scalar",
					T: 9
				},
				{
					no: 2,
					name: "header",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "body",
					kind: "scalar",
					T: 9
				},
				{
					no: 4,
					name: "help_article_id",
					kind: "scalar",
					T: 9
				},
				{
					no: 5,
					name: "button",
					kind: "message",
					T: () => exports.PremiumMarketingComponentProperties_CTAButton
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.assetUrl = "";
			message.header = "";
			message.body = "";
			message.helpArticleId = "";
			if (value !== undefined) (0, runtime_3$3.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.assetUrl = reader.string();
						break;
					case 2:
						message.header = reader.string();
						break;
					case 3:
						message.body = reader.string();
						break;
					case 4:
						message.helpArticleId = reader.string();
						break;
					case 5:
						message.button = exports.PremiumMarketingComponentProperties_CTAButton.internalBinaryRead(reader, reader.uint32(), options, message.button);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$3.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.assetUrl !== "") writer.tag(1, runtime_1$4.WireType.LengthDelimited).string(message.assetUrl);
			if (message.header !== "") writer.tag(2, runtime_1$4.WireType.LengthDelimited).string(message.header);
			if (message.body !== "") writer.tag(3, runtime_1$4.WireType.LengthDelimited).string(message.body);
			if (message.helpArticleId !== "") writer.tag(4, runtime_1$4.WireType.LengthDelimited).string(message.helpArticleId);
			if (message.button) exports.PremiumMarketingComponentProperties_CTAButton.internalBinaryWrite(message.button, writer.tag(5, runtime_1$4.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$3.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.premium_marketing.v1.PremiumMarketingComponentProperties.MobileBottomSheet
	*/
	exports.PremiumMarketingComponentProperties_MobileBottomSheet = new PremiumMarketingComponentProperties_MobileBottomSheet$Type();
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/json-typings.js
function typeofJsonValue(value) {
	let t = typeof value;
	if (t == "object") {
		if (Array.isArray(value)) return "array";
		if (value === null) return "null";
	}
	return t;
}
function isJsonObject(value) {
	return value !== null && typeof value == "object" && !Array.isArray(value);
}
var init_json_typings = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/json-typings.js"() {} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/base64.js
function base64decode(base64Str) {
	let es = base64Str.length * 3 / 4;
	if (base64Str[base64Str.length - 2] == "=") es -= 2;
else if (base64Str[base64Str.length - 1] == "=") es -= 1;
	let bytes = new Uint8Array(es), bytePos = 0, groupPos = 0, b, p = 0;
	for (let i = 0; i < base64Str.length; i++) {
		b = decTable[base64Str.charCodeAt(i)];
		if (b === undefined) switch (base64Str[i]) {
			case "=": groupPos = 0;
			case "\n":
			case "\r":
			case "	":
			case " ": continue;
			default: throw Error(`invalid base64 string.`);
		}
		switch (groupPos) {
			case 0:
				p = b;
				groupPos = 1;
				break;
			case 1:
				bytes[bytePos++] = p << 2 | (b & 48) >> 4;
				p = b;
				groupPos = 2;
				break;
			case 2:
				bytes[bytePos++] = (p & 15) << 4 | (b & 60) >> 2;
				p = b;
				groupPos = 3;
				break;
			case 3:
				bytes[bytePos++] = (p & 3) << 6 | b;
				groupPos = 0;
				break;
		}
	}
	if (groupPos == 1) throw Error(`invalid base64 string.`);
	return bytes.subarray(0, bytePos);
}
function base64encode(bytes) {
	let base64 = "", groupPos = 0, b, p = 0;
	for (let i = 0; i < bytes.length; i++) {
		b = bytes[i];
		switch (groupPos) {
			case 0:
				base64 += encTable[b >> 2];
				p = (b & 3) << 4;
				groupPos = 1;
				break;
			case 1:
				base64 += encTable[p | b >> 4];
				p = (b & 15) << 2;
				groupPos = 2;
				break;
			case 2:
				base64 += encTable[p | b >> 6];
				base64 += encTable[b & 63];
				groupPos = 0;
				break;
		}
	}
	if (groupPos) {
		base64 += encTable[p];
		base64 += "=";
		if (groupPos == 1) base64 += "=";
	}
	return base64;
}
var encTable, decTable;
var init_base64 = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/base64.js"() {
	encTable = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
	decTable = [];
	for (let i = 0; i < encTable.length; i++) decTable[encTable[i].charCodeAt(0)] = i;
	decTable["-".charCodeAt(0)] = encTable.indexOf("+");
	decTable["_".charCodeAt(0)] = encTable.indexOf("/");
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/protobufjs-utf8.js
function utf8read(bytes) {
	if (bytes.length < 1) return "";
	let pos = 0, parts = [], chunk = [], i = 0, t;
	let len = bytes.length;
	while (pos < len) {
		t = bytes[pos++];
		if (t < 128) chunk[i++] = t;
else if (t > 191 && t < 224) chunk[i++] = (t & 31) << 6 | bytes[pos++] & 63;
else if (t > 239 && t < 365) {
			t = ((t & 7) << 18 | (bytes[pos++] & 63) << 12 | (bytes[pos++] & 63) << 6 | bytes[pos++] & 63) - 65536;
			chunk[i++] = 55296 + (t >> 10);
			chunk[i++] = 56320 + (t & 1023);
		} else chunk[i++] = (t & 15) << 12 | (bytes[pos++] & 63) << 6 | bytes[pos++] & 63;
		if (i > 8191) {
			parts.push(fromCharCodes(chunk));
			i = 0;
		}
	}
	if (parts.length) {
		if (i) parts.push(fromCharCodes(chunk.slice(0, i)));
		return parts.join("");
	}
	return fromCharCodes(chunk.slice(0, i));
}
var fromCharCodes;
var init_protobufjs_utf8 = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/protobufjs-utf8.js"() {
	fromCharCodes = (chunk) => String.fromCharCode.apply(String, chunk);
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/binary-format-contract.js
function mergeBinaryOptions(a, b) {
	return Object.assign(Object.assign({}, a), b);
}
var UnknownFieldHandler, WireType;
var init_binary_format_contract = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/binary-format-contract.js"() {
	(function(UnknownFieldHandler$1) {
		/**
		* The symbol used to store unknown fields for a message.
		* The property must conform to `UnknownFieldContainer`.
		*/
		UnknownFieldHandler$1.symbol = Symbol.for("protobuf-ts/unknown");
		/**
		* Store an unknown field during binary read directly on the message.
		* This method is compatible with `BinaryReadOptions.readUnknownField`.
		*/
		UnknownFieldHandler$1.onRead = (typeName, message, fieldNo, wireType, data) => {
			let container = is(message) ? message[UnknownFieldHandler$1.symbol] : message[UnknownFieldHandler$1.symbol] = [];
			container.push({
				no: fieldNo,
				wireType,
				data
			});
		};
		/**
		* Write unknown fields stored for the message to the writer.
		* This method is compatible with `BinaryWriteOptions.writeUnknownFields`.
		*/
		UnknownFieldHandler$1.onWrite = (typeName, message, writer) => {
			for (let { no, wireType, data } of UnknownFieldHandler$1.list(message)) writer.tag(no, wireType).raw(data);
		};
		/**
		* List unknown fields stored for the message.
		* Note that there may be multiples fields with the same number.
		*/
		UnknownFieldHandler$1.list = (message, fieldNo) => {
			if (is(message)) {
				let all = message[UnknownFieldHandler$1.symbol];
				return fieldNo ? all.filter((uf) => uf.no == fieldNo) : all;
			}
			return [];
		};
		/**
		* Returns the last unknown field by field number.
		*/
		UnknownFieldHandler$1.last = (message, fieldNo) => UnknownFieldHandler$1.list(message, fieldNo).slice(-1)[0];
		const is = (message) => message && Array.isArray(message[UnknownFieldHandler$1.symbol]);
	})(UnknownFieldHandler || (UnknownFieldHandler = {}));
	(function(WireType$1) {
		/**
		* Used for int32, int64, uint32, uint64, sint32, sint64, bool, enum
		*/
		WireType$1[WireType$1["Varint"] = 0] = "Varint";
		/**
		* Used for fixed64, sfixed64, double.
		* Always 8 bytes with little-endian byte order.
		*/
		WireType$1[WireType$1["Bit64"] = 1] = "Bit64";
		/**
		* Used for string, bytes, embedded messages, packed repeated fields
		*
		* Only repeated numeric types (types which use the varint, 32-bit,
		* or 64-bit wire types) can be packed. In proto3, such fields are
		* packed by default.
		*/
		WireType$1[WireType$1["LengthDelimited"] = 2] = "LengthDelimited";
		/**
		* Used for groups
		* @deprecated
		*/
		WireType$1[WireType$1["StartGroup"] = 3] = "StartGroup";
		/**
		* Used for groups
		* @deprecated
		*/
		WireType$1[WireType$1["EndGroup"] = 4] = "EndGroup";
		/**
		* Used for fixed32, sfixed32, float.
		* Always 4 bytes with little-endian byte order.
		*/
		WireType$1[WireType$1["Bit32"] = 5] = "Bit32";
	})(WireType || (WireType = {}));
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/binary-reader.js
function binaryReadOptions(options) {
	return options ? Object.assign(Object.assign({}, defaultsRead$1), options) : defaultsRead$1;
}
var defaultsRead$1, BinaryReader;
var init_binary_reader = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/binary-reader.js"() {
	init_binary_format_contract();
	init_pb_long();
	init_goog_varint();
	defaultsRead$1 = {
		readUnknownField: true,
		readerFactory: (bytes) => new BinaryReader(bytes)
	};
	BinaryReader = class {
		constructor(buf, textDecoder) {
			this.varint64 = varint64read;
			/**
			* Read a `uint32` field, an unsigned 32 bit varint.
			*/
			this.uint32 = varint32read;
			this.buf = buf;
			this.len = buf.length;
			this.pos = 0;
			this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
			this.textDecoder = textDecoder !== null && textDecoder !== void 0 ? textDecoder : new TextDecoder("utf-8", {
				fatal: true,
				ignoreBOM: true
			});
		}
		/**
		* Reads a tag - field number and wire type.
		*/
		tag() {
			let tag = this.uint32(), fieldNo = tag >>> 3, wireType = tag & 7;
			if (fieldNo <= 0 || wireType < 0 || wireType > 5) throw new Error("illegal tag: field no " + fieldNo + " wire type " + wireType);
			return [fieldNo, wireType];
		}
		/**
		* Skip one element on the wire and return the skipped data.
		* Supports WireType.StartGroup since v2.0.0-alpha.23.
		*/
		skip(wireType) {
			let start = this.pos;
			switch (wireType) {
				case WireType.Varint:
					while (this.buf[this.pos++] & 128);
					break;
				case WireType.Bit64: this.pos += 4;
				case WireType.Bit32:
					this.pos += 4;
					break;
				case WireType.LengthDelimited:
					let len = this.uint32();
					this.pos += len;
					break;
				case WireType.StartGroup:
					let t;
					while ((t = this.tag()[1]) !== WireType.EndGroup) this.skip(t);
					break;
				default: throw new Error("cant skip wire type " + wireType);
			}
			this.assertBounds();
			return this.buf.subarray(start, this.pos);
		}
		/**
		* Throws error if position in byte array is out of range.
		*/
		assertBounds() {
			if (this.pos > this.len) throw new RangeError("premature EOF");
		}
		/**
		* Read a `int32` field, a signed 32 bit varint.
		*/
		int32() {
			return this.uint32() | 0;
		}
		/**
		* Read a `sint32` field, a signed, zigzag-encoded 32-bit varint.
		*/
		sint32() {
			let zze = this.uint32();
			return zze >>> 1 ^ -(zze & 1);
		}
		/**
		* Read a `int64` field, a signed 64-bit varint.
		*/
		int64() {
			return new PbLong(...this.varint64());
		}
		/**
		* Read a `uint64` field, an unsigned 64-bit varint.
		*/
		uint64() {
			return new PbULong(...this.varint64());
		}
		/**
		* Read a `sint64` field, a signed, zig-zag-encoded 64-bit varint.
		*/
		sint64() {
			let [lo, hi] = this.varint64();
			let s = -(lo & 1);
			lo = (lo >>> 1 | (hi & 1) << 31) ^ s;
			hi = hi >>> 1 ^ s;
			return new PbLong(lo, hi);
		}
		/**
		* Read a `bool` field, a variant.
		*/
		bool() {
			let [lo, hi] = this.varint64();
			return lo !== 0 || hi !== 0;
		}
		/**
		* Read a `fixed32` field, an unsigned, fixed-length 32-bit integer.
		*/
		fixed32() {
			return this.view.getUint32((this.pos += 4) - 4, true);
		}
		/**
		* Read a `sfixed32` field, a signed, fixed-length 32-bit integer.
		*/
		sfixed32() {
			return this.view.getInt32((this.pos += 4) - 4, true);
		}
		/**
		* Read a `fixed64` field, an unsigned, fixed-length 64 bit integer.
		*/
		fixed64() {
			return new PbULong(this.sfixed32(), this.sfixed32());
		}
		/**
		* Read a `fixed64` field, a signed, fixed-length 64-bit integer.
		*/
		sfixed64() {
			return new PbLong(this.sfixed32(), this.sfixed32());
		}
		/**
		* Read a `float` field, 32-bit floating point number.
		*/
		float() {
			return this.view.getFloat32((this.pos += 4) - 4, true);
		}
		/**
		* Read a `double` field, a 64-bit floating point number.
		*/
		double() {
			return this.view.getFloat64((this.pos += 8) - 8, true);
		}
		/**
		* Read a `bytes` field, length-delimited arbitrary data.
		*/
		bytes() {
			let len = this.uint32();
			let start = this.pos;
			this.pos += len;
			this.assertBounds();
			return this.buf.subarray(start, start + len);
		}
		/**
		* Read a `string` field, length-delimited data converted to UTF-8 text.
		*/
		string() {
			return this.textDecoder.decode(this.bytes());
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/binary-writer.js
function binaryWriteOptions(options) {
	return options ? Object.assign(Object.assign({}, defaultsWrite$1), options) : defaultsWrite$1;
}
var defaultsWrite$1, BinaryWriter;
var init_binary_writer = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/binary-writer.js"() {
	init_pb_long();
	init_goog_varint();
	init_assert();
	defaultsWrite$1 = {
		writeUnknownFields: true,
		writerFactory: () => new BinaryWriter()
	};
	BinaryWriter = class {
		constructor(textEncoder) {
			/**
			* Previous fork states.
			*/
			this.stack = [];
			this.textEncoder = textEncoder !== null && textEncoder !== void 0 ? textEncoder : new TextEncoder();
			this.chunks = [];
			this.buf = [];
		}
		/**
		* Return all bytes written and reset this writer.
		*/
		finish() {
			this.chunks.push(new Uint8Array(this.buf));
			let len = 0;
			for (let i = 0; i < this.chunks.length; i++) len += this.chunks[i].length;
			let bytes = new Uint8Array(len);
			let offset = 0;
			for (let i = 0; i < this.chunks.length; i++) {
				bytes.set(this.chunks[i], offset);
				offset += this.chunks[i].length;
			}
			this.chunks = [];
			return bytes;
		}
		/**
		* Start a new fork for length-delimited data like a message
		* or a packed repeated field.
		*
		* Must be joined later with `join()`.
		*/
		fork() {
			this.stack.push({
				chunks: this.chunks,
				buf: this.buf
			});
			this.chunks = [];
			this.buf = [];
			return this;
		}
		/**
		* Join the last fork. Write its length and bytes, then
		* return to the previous state.
		*/
		join() {
			let chunk = this.finish();
			let prev = this.stack.pop();
			if (!prev) throw new Error("invalid state, fork stack empty");
			this.chunks = prev.chunks;
			this.buf = prev.buf;
			this.uint32(chunk.byteLength);
			return this.raw(chunk);
		}
		/**
		* Writes a tag (field number and wire type).
		*
		* Equivalent to `uint32( (fieldNo << 3 | type) >>> 0 )`.
		*
		* Generated code should compute the tag ahead of time and call `uint32()`.
		*/
		tag(fieldNo, type) {
			return this.uint32((fieldNo << 3 | type) >>> 0);
		}
		/**
		* Write a chunk of raw bytes.
		*/
		raw(chunk) {
			if (this.buf.length) {
				this.chunks.push(new Uint8Array(this.buf));
				this.buf = [];
			}
			this.chunks.push(chunk);
			return this;
		}
		/**
		* Write a `uint32` value, an unsigned 32 bit varint.
		*/
		uint32(value) {
			assertUInt32(value);
			while (value > 127) {
				this.buf.push(value & 127 | 128);
				value = value >>> 7;
			}
			this.buf.push(value);
			return this;
		}
		/**
		* Write a `int32` value, a signed 32 bit varint.
		*/
		int32(value) {
			assertInt32(value);
			varint32write(value, this.buf);
			return this;
		}
		/**
		* Write a `bool` value, a variant.
		*/
		bool(value) {
			this.buf.push(value ? 1 : 0);
			return this;
		}
		/**
		* Write a `bytes` value, length-delimited arbitrary data.
		*/
		bytes(value) {
			this.uint32(value.byteLength);
			return this.raw(value);
		}
		/**
		* Write a `string` value, length-delimited data converted to UTF-8 text.
		*/
		string(value) {
			let chunk = this.textEncoder.encode(value);
			this.uint32(chunk.byteLength);
			return this.raw(chunk);
		}
		/**
		* Write a `float` value, 32-bit floating point number.
		*/
		float(value) {
			assertFloat32(value);
			let chunk = new Uint8Array(4);
			new DataView(chunk.buffer).setFloat32(0, value, true);
			return this.raw(chunk);
		}
		/**
		* Write a `double` value, a 64-bit floating point number.
		*/
		double(value) {
			let chunk = new Uint8Array(8);
			new DataView(chunk.buffer).setFloat64(0, value, true);
			return this.raw(chunk);
		}
		/**
		* Write a `fixed32` value, an unsigned, fixed-length 32-bit integer.
		*/
		fixed32(value) {
			assertUInt32(value);
			let chunk = new Uint8Array(4);
			new DataView(chunk.buffer).setUint32(0, value, true);
			return this.raw(chunk);
		}
		/**
		* Write a `sfixed32` value, a signed, fixed-length 32-bit integer.
		*/
		sfixed32(value) {
			assertInt32(value);
			let chunk = new Uint8Array(4);
			new DataView(chunk.buffer).setInt32(0, value, true);
			return this.raw(chunk);
		}
		/**
		* Write a `sint32` value, a signed, zigzag-encoded 32-bit varint.
		*/
		sint32(value) {
			assertInt32(value);
			value = (value << 1 ^ value >> 31) >>> 0;
			varint32write(value, this.buf);
			return this;
		}
		/**
		* Write a `fixed64` value, a signed, fixed-length 64-bit integer.
		*/
		sfixed64(value) {
			let chunk = new Uint8Array(8);
			let view = new DataView(chunk.buffer);
			let long = PbLong.from(value);
			view.setInt32(0, long.lo, true);
			view.setInt32(4, long.hi, true);
			return this.raw(chunk);
		}
		/**
		* Write a `fixed64` value, an unsigned, fixed-length 64 bit integer.
		*/
		fixed64(value) {
			let chunk = new Uint8Array(8);
			let view = new DataView(chunk.buffer);
			let long = PbULong.from(value);
			view.setInt32(0, long.lo, true);
			view.setInt32(4, long.hi, true);
			return this.raw(chunk);
		}
		/**
		* Write a `int64` value, a signed 64-bit varint.
		*/
		int64(value) {
			let long = PbLong.from(value);
			varint64write(long.lo, long.hi, this.buf);
			return this;
		}
		/**
		* Write a `sint64` value, a signed, zig-zag-encoded 64-bit varint.
		*/
		sint64(value) {
			let long = PbLong.from(value), sign = long.hi >> 31, lo = long.lo << 1 ^ sign, hi = (long.hi << 1 | long.lo >>> 31) ^ sign;
			varint64write(lo, hi, this.buf);
			return this;
		}
		/**
		* Write a `uint64` value, an unsigned 64-bit varint.
		*/
		uint64(value) {
			let long = PbULong.from(value);
			varint64write(long.lo, long.hi, this.buf);
			return this;
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/pb-long.js
function detectBi() {
	const dv = new DataView(new ArrayBuffer(8));
	const ok = globalThis.BigInt !== undefined && typeof dv.getBigInt64 === "function" && typeof dv.getBigUint64 === "function" && typeof dv.setBigInt64 === "function" && typeof dv.setBigUint64 === "function";
	BI = ok ? {
		MIN: BigInt("-9223372036854775808"),
		MAX: BigInt("9223372036854775807"),
		UMIN: BigInt("0"),
		UMAX: BigInt("18446744073709551615"),
		C: BigInt,
		V: dv
	} : undefined;
}
function assertBi(bi) {
	if (!bi) throw new Error("BigInt unavailable, see https://github.com/timostamm/protobuf-ts/blob/v1.0.8/MANUAL.md#bigint-support");
}
var BI, RE_DECIMAL_STR, TWO_PWR_32_DBL$1, HALF_2_PWR_32, SharedPbLong, PbULong, PbLong;
var init_pb_long = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/pb-long.js"() {
	init_goog_varint();
	detectBi();
	RE_DECIMAL_STR = /^-?[0-9]+$/;
	TWO_PWR_32_DBL$1 = 4294967296;
	HALF_2_PWR_32 = 2147483648;
	SharedPbLong = class {
		/**
		* Create a new instance with the given bits.
		*/
		constructor(lo, hi) {
			this.lo = lo | 0;
			this.hi = hi | 0;
		}
		/**
		* Is this instance equal to 0?
		*/
		isZero() {
			return this.lo == 0 && this.hi == 0;
		}
		/**
		* Convert to a native number.
		*/
		toNumber() {
			let result = this.hi * TWO_PWR_32_DBL$1 + (this.lo >>> 0);
			if (!Number.isSafeInteger(result)) throw new Error("cannot convert to safe number");
			return result;
		}
	};
	PbULong = class PbULong extends SharedPbLong {
		/**
		* Create instance from a `string`, `number` or `bigint`.
		*/
		static from(value) {
			if (BI) switch (typeof value) {
				case "string":
					if (value == "0") return this.ZERO;
					if (value == "") throw new Error("string is no integer");
					value = BI.C(value);
				case "number":
					if (value === 0) return this.ZERO;
					value = BI.C(value);
				case "bigint":
					if (!value) return this.ZERO;
					if (value < BI.UMIN) throw new Error("signed value for ulong");
					if (value > BI.UMAX) throw new Error("ulong too large");
					BI.V.setBigUint64(0, value, true);
					return new PbULong(BI.V.getInt32(0, true), BI.V.getInt32(4, true));
			}
else switch (typeof value) {
				case "string":
					if (value == "0") return this.ZERO;
					value = value.trim();
					if (!RE_DECIMAL_STR.test(value)) throw new Error("string is no integer");
					let [minus, lo, hi] = int64fromString(value);
					if (minus) throw new Error("signed value for ulong");
					return new PbULong(lo, hi);
				case "number":
					if (value == 0) return this.ZERO;
					if (!Number.isSafeInteger(value)) throw new Error("number is no integer");
					if (value < 0) throw new Error("signed value for ulong");
					return new PbULong(value, value / TWO_PWR_32_DBL$1);
			}
			throw new Error("unknown value " + typeof value);
		}
		/**
		* Convert to decimal string.
		*/
		toString() {
			return BI ? this.toBigInt().toString() : int64toString(this.lo, this.hi);
		}
		/**
		* Convert to native bigint.
		*/
		toBigInt() {
			assertBi(BI);
			BI.V.setInt32(0, this.lo, true);
			BI.V.setInt32(4, this.hi, true);
			return BI.V.getBigUint64(0, true);
		}
	};
	/**
	* ulong 0 singleton.
	*/
	PbULong.ZERO = new PbULong(0, 0);
	PbLong = class PbLong extends SharedPbLong {
		/**
		* Create instance from a `string`, `number` or `bigint`.
		*/
		static from(value) {
			if (BI) switch (typeof value) {
				case "string":
					if (value == "0") return this.ZERO;
					if (value == "") throw new Error("string is no integer");
					value = BI.C(value);
				case "number":
					if (value === 0) return this.ZERO;
					value = BI.C(value);
				case "bigint":
					if (!value) return this.ZERO;
					if (value < BI.MIN) throw new Error("signed long too small");
					if (value > BI.MAX) throw new Error("signed long too large");
					BI.V.setBigInt64(0, value, true);
					return new PbLong(BI.V.getInt32(0, true), BI.V.getInt32(4, true));
			}
else switch (typeof value) {
				case "string":
					if (value == "0") return this.ZERO;
					value = value.trim();
					if (!RE_DECIMAL_STR.test(value)) throw new Error("string is no integer");
					let [minus, lo, hi] = int64fromString(value);
					if (minus) {
						if (hi > HALF_2_PWR_32 || hi == HALF_2_PWR_32 && lo != 0) throw new Error("signed long too small");
					} else if (hi >= HALF_2_PWR_32) throw new Error("signed long too large");
					let pbl = new PbLong(lo, hi);
					return minus ? pbl.negate() : pbl;
				case "number":
					if (value == 0) return this.ZERO;
					if (!Number.isSafeInteger(value)) throw new Error("number is no integer");
					return value > 0 ? new PbLong(value, value / TWO_PWR_32_DBL$1) : new PbLong(-value, -value / TWO_PWR_32_DBL$1).negate();
			}
			throw new Error("unknown value " + typeof value);
		}
		/**
		* Do we have a minus sign?
		*/
		isNegative() {
			return (this.hi & HALF_2_PWR_32) !== 0;
		}
		/**
		* Negate two's complement.
		* Invert all the bits and add one to the result.
		*/
		negate() {
			let hi = ~this.hi, lo = this.lo;
			if (lo) lo = ~lo + 1;
else hi += 1;
			return new PbLong(lo, hi);
		}
		/**
		* Convert to decimal string.
		*/
		toString() {
			if (BI) return this.toBigInt().toString();
			if (this.isNegative()) {
				let n = this.negate();
				return "-" + int64toString(n.lo, n.hi);
			}
			return int64toString(this.lo, this.hi);
		}
		/**
		* Convert to native bigint.
		*/
		toBigInt() {
			assertBi(BI);
			BI.V.setInt32(0, this.lo, true);
			BI.V.setInt32(4, this.hi, true);
			return BI.V.getBigInt64(0, true);
		}
	};
	/**
	* long 0 singleton.
	*/
	PbLong.ZERO = new PbLong(0, 0);
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/json-format-contract.js
function jsonReadOptions(options) {
	return options ? Object.assign(Object.assign({}, defaultsRead), options) : defaultsRead;
}
function jsonWriteOptions(options) {
	return options ? Object.assign(Object.assign({}, defaultsWrite), options) : defaultsWrite;
}
function mergeJsonOptions(a, b) {
	var _a, _b;
	let c = Object.assign(Object.assign({}, a), b);
	c.typeRegistry = [...(_a = a === null || a === void 0 ? void 0 : a.typeRegistry) !== null && _a !== void 0 ? _a : [], ...(_b = b === null || b === void 0 ? void 0 : b.typeRegistry) !== null && _b !== void 0 ? _b : []];
	return c;
}
var defaultsWrite, defaultsRead;
var init_json_format_contract = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/json-format-contract.js"() {
	defaultsWrite = {
		emitDefaultValues: false,
		enumAsInteger: false,
		useProtoFieldName: false,
		prettySpaces: 0
	}, defaultsRead = { ignoreUnknownFields: false };
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/message-type-contract.js
var MESSAGE_TYPE;
var init_message_type_contract = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/message-type-contract.js"() {
	MESSAGE_TYPE = Symbol.for("protobuf-ts/message-type");
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_users/v1/FrecencyUserSettings.js
var require_FrecencyUserSettings = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/discord_users/v1/FrecencyUserSettings.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.FrecencyUserSettings_GuildAndChannelFrecency = exports.FrecencyUserSettings_PlayedSoundFrecency = exports.FrecencyUserSettings_HeardSoundFrecency = exports.FrecencyUserSettings_ApplicationFrecency = exports.FrecencyUserSettings_FavoriteSoundboardSounds = exports.FrecencyUserSettings_ApplicationCommandFrecency = exports.FrecencyUserSettings_EmojiFrecency = exports.FrecencyUserSettings_FavoriteEmojis = exports.FrecencyUserSettings_StickerFrecency = exports.FrecencyUserSettings_FrecencyItem = exports.FrecencyUserSettings_FavoriteStickers = exports.FrecencyUserSettings_FavoriteGIFs = exports.FrecencyUserSettings_FavoriteGIF = exports.FrecencyUserSettings_Versions = exports.FrecencyUserSettings = exports.FrecencyUserSettings_GIFType = void 0;
	const runtime_1$3 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$2 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$2 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$2 = (init_es2015(), __toCommonJS(es2015_exports));
	/**
	* @generated from protobuf enum discord_protos.discord_users.v1.FrecencyUserSettings.GIFType
	*/
	var FrecencyUserSettings_GIFType;
	(function(FrecencyUserSettings_GIFType$1) {
		/**
		* @generated from protobuf enum value: GIF_TYPE_NONE = 0;
		*/
		FrecencyUserSettings_GIFType$1[FrecencyUserSettings_GIFType$1["GIF_TYPE_NONE"] = 0] = "GIF_TYPE_NONE";
		/**
		* @generated from protobuf enum value: GIF_TYPE_IMAGE = 1;
		*/
		FrecencyUserSettings_GIFType$1[FrecencyUserSettings_GIFType$1["GIF_TYPE_IMAGE"] = 1] = "GIF_TYPE_IMAGE";
		/**
		* @generated from protobuf enum value: GIF_TYPE_VIDEO = 2;
		*/
		FrecencyUserSettings_GIFType$1[FrecencyUserSettings_GIFType$1["GIF_TYPE_VIDEO"] = 2] = "GIF_TYPE_VIDEO";
	})(FrecencyUserSettings_GIFType || (exports.FrecencyUserSettings_GIFType = FrecencyUserSettings_GIFType = {}));
	var FrecencyUserSettings$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings", [
				{
					no: 1,
					name: "versions",
					kind: "message",
					T: () => exports.FrecencyUserSettings_Versions
				},
				{
					no: 2,
					name: "favorite_gifs",
					kind: "message",
					T: () => exports.FrecencyUserSettings_FavoriteGIFs
				},
				{
					no: 3,
					name: "favorite_stickers",
					kind: "message",
					T: () => exports.FrecencyUserSettings_FavoriteStickers
				},
				{
					no: 4,
					name: "sticker_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_StickerFrecency
				},
				{
					no: 5,
					name: "favorite_emojis",
					kind: "message",
					T: () => exports.FrecencyUserSettings_FavoriteEmojis
				},
				{
					no: 6,
					name: "emoji_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_EmojiFrecency
				},
				{
					no: 7,
					name: "application_command_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_ApplicationCommandFrecency
				},
				{
					no: 8,
					name: "favorite_soundboard_sounds",
					kind: "message",
					T: () => exports.FrecencyUserSettings_FavoriteSoundboardSounds
				},
				{
					no: 9,
					name: "application_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_ApplicationFrecency
				},
				{
					no: 10,
					name: "heard_sound_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_HeardSoundFrecency
				},
				{
					no: 11,
					name: "played_sound_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_PlayedSoundFrecency
				},
				{
					no: 12,
					name: "guild_and_channel_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_GuildAndChannelFrecency
				},
				{
					no: 13,
					name: "emoji_reaction_frecency",
					kind: "message",
					T: () => exports.FrecencyUserSettings_EmojiFrecency
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.versions = exports.FrecencyUserSettings_Versions.internalBinaryRead(reader, reader.uint32(), options, message.versions);
						break;
					case 2:
						message.favoriteGifs = exports.FrecencyUserSettings_FavoriteGIFs.internalBinaryRead(reader, reader.uint32(), options, message.favoriteGifs);
						break;
					case 3:
						message.favoriteStickers = exports.FrecencyUserSettings_FavoriteStickers.internalBinaryRead(reader, reader.uint32(), options, message.favoriteStickers);
						break;
					case 4:
						message.stickerFrecency = exports.FrecencyUserSettings_StickerFrecency.internalBinaryRead(reader, reader.uint32(), options, message.stickerFrecency);
						break;
					case 5:
						message.favoriteEmojis = exports.FrecencyUserSettings_FavoriteEmojis.internalBinaryRead(reader, reader.uint32(), options, message.favoriteEmojis);
						break;
					case 6:
						message.emojiFrecency = exports.FrecencyUserSettings_EmojiFrecency.internalBinaryRead(reader, reader.uint32(), options, message.emojiFrecency);
						break;
					case 7:
						message.applicationCommandFrecency = exports.FrecencyUserSettings_ApplicationCommandFrecency.internalBinaryRead(reader, reader.uint32(), options, message.applicationCommandFrecency);
						break;
					case 8:
						message.favoriteSoundboardSounds = exports.FrecencyUserSettings_FavoriteSoundboardSounds.internalBinaryRead(reader, reader.uint32(), options, message.favoriteSoundboardSounds);
						break;
					case 9:
						message.applicationFrecency = exports.FrecencyUserSettings_ApplicationFrecency.internalBinaryRead(reader, reader.uint32(), options, message.applicationFrecency);
						break;
					case 10:
						message.heardSoundFrecency = exports.FrecencyUserSettings_HeardSoundFrecency.internalBinaryRead(reader, reader.uint32(), options, message.heardSoundFrecency);
						break;
					case 11:
						message.playedSoundFrecency = exports.FrecencyUserSettings_PlayedSoundFrecency.internalBinaryRead(reader, reader.uint32(), options, message.playedSoundFrecency);
						break;
					case 12:
						message.guildAndChannelFrecency = exports.FrecencyUserSettings_GuildAndChannelFrecency.internalBinaryRead(reader, reader.uint32(), options, message.guildAndChannelFrecency);
						break;
					case 13:
						message.emojiReactionFrecency = exports.FrecencyUserSettings_EmojiFrecency.internalBinaryRead(reader, reader.uint32(), options, message.emojiReactionFrecency);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.versions) exports.FrecencyUserSettings_Versions.internalBinaryWrite(message.versions, writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.favoriteGifs) exports.FrecencyUserSettings_FavoriteGIFs.internalBinaryWrite(message.favoriteGifs, writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.favoriteStickers) exports.FrecencyUserSettings_FavoriteStickers.internalBinaryWrite(message.favoriteStickers, writer.tag(3, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.stickerFrecency) exports.FrecencyUserSettings_StickerFrecency.internalBinaryWrite(message.stickerFrecency, writer.tag(4, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.favoriteEmojis) exports.FrecencyUserSettings_FavoriteEmojis.internalBinaryWrite(message.favoriteEmojis, writer.tag(5, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.emojiFrecency) exports.FrecencyUserSettings_EmojiFrecency.internalBinaryWrite(message.emojiFrecency, writer.tag(6, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.applicationCommandFrecency) exports.FrecencyUserSettings_ApplicationCommandFrecency.internalBinaryWrite(message.applicationCommandFrecency, writer.tag(7, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.favoriteSoundboardSounds) exports.FrecencyUserSettings_FavoriteSoundboardSounds.internalBinaryWrite(message.favoriteSoundboardSounds, writer.tag(8, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.applicationFrecency) exports.FrecencyUserSettings_ApplicationFrecency.internalBinaryWrite(message.applicationFrecency, writer.tag(9, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.heardSoundFrecency) exports.FrecencyUserSettings_HeardSoundFrecency.internalBinaryWrite(message.heardSoundFrecency, writer.tag(10, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.playedSoundFrecency) exports.FrecencyUserSettings_PlayedSoundFrecency.internalBinaryWrite(message.playedSoundFrecency, writer.tag(11, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.guildAndChannelFrecency) exports.FrecencyUserSettings_GuildAndChannelFrecency.internalBinaryWrite(message.guildAndChannelFrecency, writer.tag(12, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			if (message.emojiReactionFrecency) exports.FrecencyUserSettings_EmojiFrecency.internalBinaryWrite(message.emojiReactionFrecency, writer.tag(13, runtime_1$3.WireType.LengthDelimited).fork(), options).join();
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings
	*/
	exports.FrecencyUserSettings = new FrecencyUserSettings$Type();
	var FrecencyUserSettings_Versions$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.Versions", [
				{
					no: 1,
					name: "client_version",
					kind: "scalar",
					T: 13
				},
				{
					no: 2,
					name: "server_version",
					kind: "scalar",
					T: 13
				},
				{
					no: 3,
					name: "data_version",
					kind: "scalar",
					T: 13
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.clientVersion = 0;
			message.serverVersion = 0;
			message.dataVersion = 0;
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.clientVersion = reader.uint32();
						break;
					case 2:
						message.serverVersion = reader.uint32();
						break;
					case 3:
						message.dataVersion = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.clientVersion !== 0) writer.tag(1, runtime_1$3.WireType.Varint).uint32(message.clientVersion);
			if (message.serverVersion !== 0) writer.tag(2, runtime_1$3.WireType.Varint).uint32(message.serverVersion);
			if (message.dataVersion !== 0) writer.tag(3, runtime_1$3.WireType.Varint).uint32(message.dataVersion);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.Versions
	*/
	exports.FrecencyUserSettings_Versions = new FrecencyUserSettings_Versions$Type();
	var FrecencyUserSettings_FavoriteGIF$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteGIF", [
				{
					no: 1,
					name: "format",
					kind: "enum",
					T: () => ["discord_protos.discord_users.v1.FrecencyUserSettings.GIFType", FrecencyUserSettings_GIFType]
				},
				{
					no: 2,
					name: "src",
					kind: "scalar",
					T: 9
				},
				{
					no: 3,
					name: "width",
					kind: "scalar",
					T: 13
				},
				{
					no: 4,
					name: "height",
					kind: "scalar",
					T: 13
				},
				{
					no: 5,
					name: "order",
					kind: "scalar",
					T: 13
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.format = 0;
			message.src = "";
			message.width = 0;
			message.height = 0;
			message.order = 0;
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.format = reader.int32();
						break;
					case 2:
						message.src = reader.string();
						break;
					case 3:
						message.width = reader.uint32();
						break;
					case 4:
						message.height = reader.uint32();
						break;
					case 5:
						message.order = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.format !== 0) writer.tag(1, runtime_1$3.WireType.Varint).int32(message.format);
			if (message.src !== "") writer.tag(2, runtime_1$3.WireType.LengthDelimited).string(message.src);
			if (message.width !== 0) writer.tag(3, runtime_1$3.WireType.Varint).uint32(message.width);
			if (message.height !== 0) writer.tag(4, runtime_1$3.WireType.Varint).uint32(message.height);
			if (message.order !== 0) writer.tag(5, runtime_1$3.WireType.Varint).uint32(message.order);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteGIF
	*/
	exports.FrecencyUserSettings_FavoriteGIF = new FrecencyUserSettings_FavoriteGIF$Type();
	var FrecencyUserSettings_FavoriteGIFs$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteGIFs", [{
				no: 1,
				name: "gifs",
				kind: "map",
				K: 9,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FavoriteGIF
				}
			}, {
				no: 2,
				name: "hide_tooltip",
				kind: "scalar",
				T: 8
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.gifs = {};
			message.hideTooltip = false;
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.gifs, reader, options);
						break;
					case 2:
						message.hideTooltip = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FavoriteGIF.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteGIFs.gifs");
				}
			}
			map[key ?? ""] = val ?? exports.FrecencyUserSettings_FavoriteGIF.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.gifs)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.LengthDelimited).string(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FavoriteGIF.internalBinaryWrite(message.gifs[k], writer, options);
				writer.join().join();
			}
			if (message.hideTooltip !== false) writer.tag(2, runtime_1$3.WireType.Varint).bool(message.hideTooltip);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteGIFs
	*/
	exports.FrecencyUserSettings_FavoriteGIFs = new FrecencyUserSettings_FavoriteGIFs$Type();
	var FrecencyUserSettings_FavoriteStickers$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteStickers", [{
				no: 1,
				name: "sticker_ids",
				kind: "scalar",
				repeat: 1,
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.stickerIds = [];
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (wireType === runtime_1$3.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.stickerIds.push(reader.fixed64().toBigInt());
else message.stickerIds.push(reader.fixed64().toBigInt());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.stickerIds.length) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.stickerIds.length; i++) writer.fixed64(message.stickerIds[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteStickers
	*/
	exports.FrecencyUserSettings_FavoriteStickers = new FrecencyUserSettings_FavoriteStickers$Type();
	var FrecencyUserSettings_FrecencyItem$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.FrecencyItem", [
				{
					no: 1,
					name: "total_uses",
					kind: "scalar",
					T: 13
				},
				{
					no: 2,
					name: "recent_uses",
					kind: "scalar",
					repeat: 1,
					T: 4,
					L: 0
				},
				{
					no: 3,
					name: "frecency",
					kind: "scalar",
					T: 5
				},
				{
					no: 4,
					name: "score",
					kind: "scalar",
					T: 5
				}
			]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.totalUses = 0;
			message.recentUses = [];
			message.frecency = 0;
			message.score = 0;
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.totalUses = reader.uint32();
						break;
					case 2:
						if (wireType === runtime_1$3.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.recentUses.push(reader.uint64().toBigInt());
else message.recentUses.push(reader.uint64().toBigInt());
						break;
					case 3:
						message.frecency = reader.int32();
						break;
					case 4:
						message.score = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.totalUses !== 0) writer.tag(1, runtime_1$3.WireType.Varint).uint32(message.totalUses);
			if (message.recentUses.length) {
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.recentUses.length; i++) writer.uint64(message.recentUses[i]);
				writer.join();
			}
			if (message.frecency !== 0) writer.tag(3, runtime_1$3.WireType.Varint).int32(message.frecency);
			if (message.score !== 0) writer.tag(4, runtime_1$3.WireType.Varint).int32(message.score);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.FrecencyItem
	*/
	exports.FrecencyUserSettings_FrecencyItem = new FrecencyUserSettings_FrecencyItem$Type();
	var FrecencyUserSettings_StickerFrecency$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.StickerFrecency", [{
				no: 1,
				name: "stickers",
				kind: "map",
				K: 6,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FrecencyItem
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.stickers = {};
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.stickers, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FrecencyItem.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.StickerFrecency.stickers");
				}
			}
			map[key ?? "0"] = val ?? exports.FrecencyUserSettings_FrecencyItem.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.stickers)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FrecencyItem.internalBinaryWrite(message.stickers[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.StickerFrecency
	*/
	exports.FrecencyUserSettings_StickerFrecency = new FrecencyUserSettings_StickerFrecency$Type();
	var FrecencyUserSettings_FavoriteEmojis$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteEmojis", [{
				no: 1,
				name: "emojis",
				kind: "scalar",
				repeat: 2,
				T: 9
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.emojis = [];
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.emojis.push(reader.string());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			for (let i = 0; i < message.emojis.length; i++) writer.tag(1, runtime_1$3.WireType.LengthDelimited).string(message.emojis[i]);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteEmojis
	*/
	exports.FrecencyUserSettings_FavoriteEmojis = new FrecencyUserSettings_FavoriteEmojis$Type();
	var FrecencyUserSettings_EmojiFrecency$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.EmojiFrecency", [{
				no: 1,
				name: "emojis",
				kind: "map",
				K: 9,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FrecencyItem
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.emojis = {};
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.emojis, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FrecencyItem.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.EmojiFrecency.emojis");
				}
			}
			map[key ?? ""] = val ?? exports.FrecencyUserSettings_FrecencyItem.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.emojis)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.LengthDelimited).string(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FrecencyItem.internalBinaryWrite(message.emojis[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.EmojiFrecency
	*/
	exports.FrecencyUserSettings_EmojiFrecency = new FrecencyUserSettings_EmojiFrecency$Type();
	var FrecencyUserSettings_ApplicationCommandFrecency$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.ApplicationCommandFrecency", [{
				no: 1,
				name: "application_commands",
				kind: "map",
				K: 9,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FrecencyItem
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.applicationCommands = {};
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.applicationCommands, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FrecencyItem.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.ApplicationCommandFrecency.application_commands");
				}
			}
			map[key ?? ""] = val ?? exports.FrecencyUserSettings_FrecencyItem.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.applicationCommands)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.LengthDelimited).string(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FrecencyItem.internalBinaryWrite(message.applicationCommands[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.ApplicationCommandFrecency
	*/
	exports.FrecencyUserSettings_ApplicationCommandFrecency = new FrecencyUserSettings_ApplicationCommandFrecency$Type();
	var FrecencyUserSettings_FavoriteSoundboardSounds$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteSoundboardSounds", [{
				no: 1,
				name: "sound_ids",
				kind: "scalar",
				repeat: 1,
				T: 6,
				L: 0
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.soundIds = [];
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (wireType === runtime_1$3.WireType.LengthDelimited) for (let e = reader.int32() + reader.pos; reader.pos < e;) message.soundIds.push(reader.fixed64().toBigInt());
else message.soundIds.push(reader.fixed64().toBigInt());
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.soundIds.length) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork();
				for (let i = 0; i < message.soundIds.length; i++) writer.fixed64(message.soundIds[i]);
				writer.join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.FavoriteSoundboardSounds
	*/
	exports.FrecencyUserSettings_FavoriteSoundboardSounds = new FrecencyUserSettings_FavoriteSoundboardSounds$Type();
	var FrecencyUserSettings_ApplicationFrecency$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.ApplicationFrecency", [{
				no: 1,
				name: "applications",
				kind: "map",
				K: 9,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FrecencyItem
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.applications = {};
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.applications, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FrecencyItem.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.ApplicationFrecency.applications");
				}
			}
			map[key ?? ""] = val ?? exports.FrecencyUserSettings_FrecencyItem.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.applications)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.LengthDelimited).string(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FrecencyItem.internalBinaryWrite(message.applications[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.ApplicationFrecency
	*/
	exports.FrecencyUserSettings_ApplicationFrecency = new FrecencyUserSettings_ApplicationFrecency$Type();
	var FrecencyUserSettings_HeardSoundFrecency$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.HeardSoundFrecency", [{
				no: 1,
				name: "heard_sounds",
				kind: "map",
				K: 9,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FrecencyItem
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.heardSounds = {};
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.heardSounds, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FrecencyItem.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.HeardSoundFrecency.heard_sounds");
				}
			}
			map[key ?? ""] = val ?? exports.FrecencyUserSettings_FrecencyItem.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.heardSounds)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.LengthDelimited).string(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FrecencyItem.internalBinaryWrite(message.heardSounds[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.HeardSoundFrecency
	*/
	exports.FrecencyUserSettings_HeardSoundFrecency = new FrecencyUserSettings_HeardSoundFrecency$Type();
	var FrecencyUserSettings_PlayedSoundFrecency$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.PlayedSoundFrecency", [{
				no: 1,
				name: "played_sounds",
				kind: "map",
				K: 9,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FrecencyItem
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.playedSounds = {};
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.playedSounds, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.string();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FrecencyItem.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.PlayedSoundFrecency.played_sounds");
				}
			}
			map[key ?? ""] = val ?? exports.FrecencyUserSettings_FrecencyItem.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.playedSounds)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.LengthDelimited).string(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FrecencyItem.internalBinaryWrite(message.playedSounds[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.PlayedSoundFrecency
	*/
	exports.FrecencyUserSettings_PlayedSoundFrecency = new FrecencyUserSettings_PlayedSoundFrecency$Type();
	var FrecencyUserSettings_GuildAndChannelFrecency$Type = class extends runtime_4$2.MessageType {
		constructor() {
			super("discord_protos.discord_users.v1.FrecencyUserSettings.GuildAndChannelFrecency", [{
				no: 1,
				name: "guild_and_channels",
				kind: "map",
				K: 6,
				V: {
					kind: "message",
					T: () => exports.FrecencyUserSettings_FrecencyItem
				}
			}]);
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.guildAndChannels = {};
			if (value !== undefined) (0, runtime_3$2.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						this.binaryReadMap1(message.guildAndChannels, reader, options);
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$2.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		binaryReadMap1(map, reader, options) {
			let len = reader.uint32(), end = reader.pos + len, key, val;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						key = reader.fixed64().toString();
						break;
					case 2:
						val = exports.FrecencyUserSettings_FrecencyItem.internalBinaryRead(reader, reader.uint32(), options);
						break;
					default: throw new globalThis.Error("unknown map entry field for discord_protos.discord_users.v1.FrecencyUserSettings.GuildAndChannelFrecency.guild_and_channels");
				}
			}
			map[key ?? "0"] = val ?? exports.FrecencyUserSettings_FrecencyItem.create();
		}
		internalBinaryWrite(message, writer, options) {
			for (let k of globalThis.Object.keys(message.guildAndChannels)) {
				writer.tag(1, runtime_1$3.WireType.LengthDelimited).fork().tag(1, runtime_1$3.WireType.Bit64).fixed64(k);
				writer.tag(2, runtime_1$3.WireType.LengthDelimited).fork();
				exports.FrecencyUserSettings_FrecencyItem.internalBinaryWrite(message.guildAndChannels[k], writer, options);
				writer.join().join();
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$2.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message discord_protos.discord_users.v1.FrecencyUserSettings.GuildAndChannelFrecency
	*/
	exports.FrecencyUserSettings_GuildAndChannelFrecency = new FrecencyUserSettings_GuildAndChannelFrecency$Type();
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-info.js
function normalizeFieldInfo(field) {
	var _a, _b, _c, _d;
	field.localName = (_a = field.localName) !== null && _a !== void 0 ? _a : lowerCamelCase(field.name);
	field.jsonName = (_b = field.jsonName) !== null && _b !== void 0 ? _b : lowerCamelCase(field.name);
	field.repeat = (_c = field.repeat) !== null && _c !== void 0 ? _c : RepeatType.NO;
	field.opt = (_d = field.opt) !== null && _d !== void 0 ? _d : field.repeat ? false : field.oneof ? false : field.kind == "message";
	return field;
}
function readFieldOptions(messageType, fieldName, extensionName, extensionType) {
	var _a;
	const options = (_a = messageType.fields.find((m, i) => m.localName == fieldName || i == fieldName)) === null || _a === void 0 ? void 0 : _a.options;
	return options && options[extensionName] ? extensionType.fromJson(options[extensionName]) : undefined;
}
function readFieldOption(messageType, fieldName, extensionName, extensionType) {
	var _a;
	const options = (_a = messageType.fields.find((m, i) => m.localName == fieldName || i == fieldName)) === null || _a === void 0 ? void 0 : _a.options;
	if (!options) return undefined;
	const optionVal = options[extensionName];
	if (optionVal === undefined) return optionVal;
	return extensionType ? extensionType.fromJson(optionVal) : optionVal;
}
function readMessageOption(messageType, extensionName, extensionType) {
	const options = messageType.options;
	const optionVal = options[extensionName];
	if (optionVal === undefined) return optionVal;
	return extensionType ? extensionType.fromJson(optionVal) : optionVal;
}
var ScalarType, LongType, RepeatType;
var init_reflection_info = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-info.js"() {
	init_lower_camel_case();
	(function(ScalarType$1) {
		ScalarType$1[ScalarType$1["DOUBLE"] = 1] = "DOUBLE";
		ScalarType$1[ScalarType$1["FLOAT"] = 2] = "FLOAT";
		ScalarType$1[ScalarType$1["INT64"] = 3] = "INT64";
		ScalarType$1[ScalarType$1["UINT64"] = 4] = "UINT64";
		ScalarType$1[ScalarType$1["INT32"] = 5] = "INT32";
		ScalarType$1[ScalarType$1["FIXED64"] = 6] = "FIXED64";
		ScalarType$1[ScalarType$1["FIXED32"] = 7] = "FIXED32";
		ScalarType$1[ScalarType$1["BOOL"] = 8] = "BOOL";
		ScalarType$1[ScalarType$1["STRING"] = 9] = "STRING";
		ScalarType$1[ScalarType$1["BYTES"] = 12] = "BYTES";
		ScalarType$1[ScalarType$1["UINT32"] = 13] = "UINT32";
		ScalarType$1[ScalarType$1["SFIXED32"] = 15] = "SFIXED32";
		ScalarType$1[ScalarType$1["SFIXED64"] = 16] = "SFIXED64";
		ScalarType$1[ScalarType$1["SINT32"] = 17] = "SINT32";
		ScalarType$1[ScalarType$1["SINT64"] = 18] = "SINT64";
	})(ScalarType || (ScalarType = {}));
	(function(LongType$1) {
		/**
		* Use JavaScript `bigint`.
		*
		* Field option `[jstype = JS_NORMAL]`.
		*/
		LongType$1[LongType$1["BIGINT"] = 0] = "BIGINT";
		/**
		* Use JavaScript `string`.
		*
		* Field option `[jstype = JS_STRING]`.
		*/
		LongType$1[LongType$1["STRING"] = 1] = "STRING";
		/**
		* Use JavaScript `number`.
		*
		* Large values will loose precision.
		*
		* Field option `[jstype = JS_NUMBER]`.
		*/
		LongType$1[LongType$1["NUMBER"] = 2] = "NUMBER";
	})(LongType || (LongType = {}));
	(function(RepeatType$1) {
		/**
		* The field is not repeated.
		*/
		RepeatType$1[RepeatType$1["NO"] = 0] = "NO";
		/**
		* The field is repeated and should be packed.
		* Invalid for `bytes` and `string`, they cannot be packed.
		*/
		RepeatType$1[RepeatType$1["PACKED"] = 1] = "PACKED";
		/**
		* The field is repeated but should not be packed.
		* The only valid repeat type for repeated `bytes` and `string`.
		*/
		RepeatType$1[RepeatType$1["UNPACKED"] = 2] = "UNPACKED";
	})(RepeatType || (RepeatType = {}));
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-type-check.js
var ReflectionTypeCheck;
var init_reflection_type_check = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-type-check.js"() {
	init_reflection_info();
	init_oneof();
	ReflectionTypeCheck = class {
		constructor(info) {
			var _a;
			this.fields = (_a = info.fields) !== null && _a !== void 0 ? _a : [];
		}
		prepare() {
			if (this.data) return;
			const req = [], known = [], oneofs = [];
			for (let field of this.fields) if (field.oneof) {
				if (!oneofs.includes(field.oneof)) {
					oneofs.push(field.oneof);
					req.push(field.oneof);
					known.push(field.oneof);
				}
			} else {
				known.push(field.localName);
				switch (field.kind) {
					case "scalar":
					case "enum":
						if (!field.opt || field.repeat) req.push(field.localName);
						break;
					case "message":
						if (field.repeat) req.push(field.localName);
						break;
					case "map":
						req.push(field.localName);
						break;
				}
			}
			this.data = {
				req,
				known,
				oneofs: Object.values(oneofs)
			};
		}
		/**
		* Is the argument a valid message as specified by the
		* reflection information?
		*
		* Checks all field types recursively. The `depth`
		* specifies how deep into the structure the check will be.
		*
		* With a depth of 0, only the presence of fields
		* is checked.
		*
		* With a depth of 1 or more, the field types are checked.
		*
		* With a depth of 2 or more, the members of map, repeated
		* and message fields are checked.
		*
		* Message fields will be checked recursively with depth - 1.
		*
		* The number of map entries / repeated values being checked
		* is < depth.
		*/
		is(message, depth, allowExcessProperties = false) {
			if (depth < 0) return true;
			if (message === null || message === undefined || typeof message != "object") return false;
			this.prepare();
			let keys = Object.keys(message), data = this.data;
			if (keys.length < data.req.length || data.req.some((n) => !keys.includes(n))) return false;
			if (!allowExcessProperties) {
				if (keys.some((k) => !data.known.includes(k))) return false;
			}
			if (depth < 1) return true;
			for (const name of data.oneofs) {
				const group = message[name];
				if (!isOneofGroup(group)) return false;
				if (group.oneofKind === undefined) continue;
				const field = this.fields.find((f) => f.localName === group.oneofKind);
				if (!field) return false;
				if (!this.field(group[group.oneofKind], field, allowExcessProperties, depth)) return false;
			}
			for (const field of this.fields) {
				if (field.oneof !== undefined) continue;
				if (!this.field(message[field.localName], field, allowExcessProperties, depth)) return false;
			}
			return true;
		}
		field(arg, field, allowExcessProperties, depth) {
			let repeated = field.repeat;
			switch (field.kind) {
				case "scalar":
					if (arg === undefined) return field.opt;
					if (repeated) return this.scalars(arg, field.T, depth, field.L);
					return this.scalar(arg, field.T, field.L);
				case "enum":
					if (arg === undefined) return field.opt;
					if (repeated) return this.scalars(arg, ScalarType.INT32, depth);
					return this.scalar(arg, ScalarType.INT32);
				case "message":
					if (arg === undefined) return true;
					if (repeated) return this.messages(arg, field.T(), allowExcessProperties, depth);
					return this.message(arg, field.T(), allowExcessProperties, depth);
				case "map":
					if (typeof arg != "object" || arg === null) return false;
					if (depth < 2) return true;
					if (!this.mapKeys(arg, field.K, depth)) return false;
					switch (field.V.kind) {
						case "scalar": return this.scalars(Object.values(arg), field.V.T, depth, field.V.L);
						case "enum": return this.scalars(Object.values(arg), ScalarType.INT32, depth);
						case "message": return this.messages(Object.values(arg), field.V.T(), allowExcessProperties, depth);
					}
					break;
			}
			return true;
		}
		message(arg, type, allowExcessProperties, depth) {
			if (allowExcessProperties) return type.isAssignable(arg, depth);
			return type.is(arg, depth);
		}
		messages(arg, type, allowExcessProperties, depth) {
			if (!Array.isArray(arg)) return false;
			if (depth < 2) return true;
			if (allowExcessProperties) {
				for (let i = 0; i < arg.length && i < depth; i++) if (!type.isAssignable(arg[i], depth - 1)) return false;
			} else for (let i = 0; i < arg.length && i < depth; i++) if (!type.is(arg[i], depth - 1)) return false;
			return true;
		}
		scalar(arg, type, longType) {
			let argType = typeof arg;
			switch (type) {
				case ScalarType.UINT64:
				case ScalarType.FIXED64:
				case ScalarType.INT64:
				case ScalarType.SFIXED64:
				case ScalarType.SINT64: switch (longType) {
					case LongType.BIGINT: return argType == "bigint";
					case LongType.NUMBER: return argType == "number" && !isNaN(arg);
					default: return argType == "string";
				}
				case ScalarType.BOOL: return argType == "boolean";
				case ScalarType.STRING: return argType == "string";
				case ScalarType.BYTES: return arg instanceof Uint8Array;
				case ScalarType.DOUBLE:
				case ScalarType.FLOAT: return argType == "number" && !isNaN(arg);
				default: return argType == "number" && Number.isInteger(arg);
			}
		}
		scalars(arg, type, depth, longType) {
			if (!Array.isArray(arg)) return false;
			if (depth < 2) return true;
			if (Array.isArray(arg)) {
				for (let i = 0; i < arg.length && i < depth; i++) if (!this.scalar(arg[i], type, longType)) return false;
			}
			return true;
		}
		mapKeys(map, type, depth) {
			let keys = Object.keys(map);
			switch (type) {
				case ScalarType.INT32:
				case ScalarType.FIXED32:
				case ScalarType.SFIXED32:
				case ScalarType.SINT32:
				case ScalarType.UINT32: return this.scalars(keys.slice(0, depth).map((k) => parseInt(k)), type, depth);
				case ScalarType.BOOL: return this.scalars(keys.slice(0, depth).map((k) => k == "true" ? true : k == "false" ? false : k), type, depth);
				default: return this.scalars(keys, type, depth, LongType.STRING);
			}
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-create.js
function reflectionCreate(type) {
	/**
	* This ternary can be removed in the next major version.
	* The `Object.create()` code path utilizes a new `messagePrototype`
	* property on the `IMessageType` which has this same `MESSAGE_TYPE`
	* non-enumerable property on it. Doing it this way means that we only
	* pay the cost of `Object.defineProperty()` once per `IMessageType`
	* class of once per "instance". The falsy code path is only provided
	* for backwards compatibility in cases where the runtime library is
	* updated without also updating the generated code.
	*/
	const msg = type.messagePrototype ? Object.create(type.messagePrototype) : Object.defineProperty({}, MESSAGE_TYPE, { value: type });
	for (let field of type.fields) {
		let name = field.localName;
		if (field.opt) continue;
		if (field.oneof) msg[field.oneof] = { oneofKind: undefined };
else if (field.repeat) msg[name] = [];
else switch (field.kind) {
			case "scalar":
				msg[name] = reflectionScalarDefault(field.T, field.L);
				break;
			case "enum":
				msg[name] = 0;
				break;
			case "map":
				msg[name] = {};
				break;
		}
	}
	return msg;
}
var init_reflection_create = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-create.js"() {
	init_reflection_scalar_default();
	init_message_type_contract();
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-scalar-default.js
function reflectionScalarDefault(type, longType = LongType.STRING) {
	switch (type) {
		case ScalarType.BOOL: return false;
		case ScalarType.UINT64:
		case ScalarType.FIXED64: return reflectionLongConvert(PbULong.ZERO, longType);
		case ScalarType.INT64:
		case ScalarType.SFIXED64:
		case ScalarType.SINT64: return reflectionLongConvert(PbLong.ZERO, longType);
		case ScalarType.DOUBLE:
		case ScalarType.FLOAT: return 0;
		case ScalarType.BYTES: return new Uint8Array(0);
		case ScalarType.STRING: return "";
		default: return 0;
	}
}
var init_reflection_scalar_default = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-scalar-default.js"() {
	init_reflection_info();
	init_reflection_long_convert();
	init_pb_long();
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-merge-partial.js
function reflectionMergePartial(info, target, source) {
	let fieldValue, input = source, output;
	for (let field of info.fields) {
		let name = field.localName;
		if (field.oneof) {
			const group = input[field.oneof];
			if ((group === null || group === void 0 ? void 0 : group.oneofKind) == undefined) continue;
			fieldValue = group[name];
			output = target[field.oneof];
			output.oneofKind = group.oneofKind;
			if (fieldValue == undefined) {
				delete output[name];
				continue;
			}
		} else {
			fieldValue = input[name];
			output = target;
			if (fieldValue == undefined) continue;
		}
		if (field.repeat) output[name].length = fieldValue.length;
		switch (field.kind) {
			case "scalar":
			case "enum":
				if (field.repeat) for (let i = 0; i < fieldValue.length; i++) output[name][i] = fieldValue[i];
else output[name] = fieldValue;
				break;
			case "message":
				let T = field.T();
				if (field.repeat) for (let i = 0; i < fieldValue.length; i++) output[name][i] = T.create(fieldValue[i]);
else if (output[name] === undefined) output[name] = T.create(fieldValue);
else T.mergePartial(output[name], fieldValue);
				break;
			case "map":
				switch (field.V.kind) {
					case "scalar":
					case "enum":
						Object.assign(output[name], fieldValue);
						break;
					case "message":
						let T$1 = field.V.T();
						for (let k of Object.keys(fieldValue)) output[name][k] = T$1.create(fieldValue[k]);
						break;
				}
				break;
		}
	}
}
var init_reflection_merge_partial = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-merge-partial.js"() {} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-equals.js
function reflectionEquals(info, a, b) {
	if (a === b) return true;
	if (!a || !b) return false;
	for (let field of info.fields) {
		let localName = field.localName;
		let val_a = field.oneof ? a[field.oneof][localName] : a[localName];
		let val_b = field.oneof ? b[field.oneof][localName] : b[localName];
		switch (field.kind) {
			case "enum":
			case "scalar":
				let t = field.kind == "enum" ? ScalarType.INT32 : field.T;
				if (!(field.repeat ? repeatedPrimitiveEq(t, val_a, val_b) : primitiveEq(t, val_a, val_b))) return false;
				break;
			case "map":
				if (!(field.V.kind == "message" ? repeatedMsgEq(field.V.T(), objectValues(val_a), objectValues(val_b)) : repeatedPrimitiveEq(field.V.kind == "enum" ? ScalarType.INT32 : field.V.T, objectValues(val_a), objectValues(val_b)))) return false;
				break;
			case "message":
				let T = field.T();
				if (!(field.repeat ? repeatedMsgEq(T, val_a, val_b) : T.equals(val_a, val_b))) return false;
				break;
		}
	}
	return true;
}
function primitiveEq(type, a, b) {
	if (a === b) return true;
	if (type !== ScalarType.BYTES) return false;
	let ba = a;
	let bb = b;
	if (ba.length !== bb.length) return false;
	for (let i = 0; i < ba.length; i++) if (ba[i] != bb[i]) return false;
	return true;
}
function repeatedPrimitiveEq(type, a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!primitiveEq(type, a[i], b[i])) return false;
	return true;
}
function repeatedMsgEq(type, a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!type.equals(a[i], b[i])) return false;
	return true;
}
var objectValues;
var init_reflection_equals = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-equals.js"() {
	init_reflection_info();
	objectValues = Object.values;
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-binary-reader.js
var ReflectionBinaryReader;
var init_reflection_binary_reader = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-binary-reader.js"() {
	init_binary_format_contract();
	init_reflection_info();
	init_reflection_long_convert();
	init_reflection_scalar_default();
	ReflectionBinaryReader = class {
		constructor(info) {
			this.info = info;
		}
		prepare() {
			var _a;
			if (!this.fieldNoToField) {
				const fieldsInput = (_a = this.info.fields) !== null && _a !== void 0 ? _a : [];
				this.fieldNoToField = new Map(fieldsInput.map((field) => [field.no, field]));
			}
		}
		/**
		* Reads a message from binary format into the target message.
		*
		* Repeated fields are appended. Map entries are added, overwriting
		* existing keys.
		*
		* If a message field is already present, it will be merged with the
		* new data.
		*/
		read(reader, message, options, length) {
			this.prepare();
			const end = length === undefined ? reader.len : reader.pos + length;
			while (reader.pos < end) {
				const [fieldNo, wireType] = reader.tag(), field = this.fieldNoToField.get(fieldNo);
				if (!field) {
					let u = options.readUnknownField;
					if (u == "throw") throw new Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.info.typeName}`);
					let d = reader.skip(wireType);
					if (u !== false) (u === true ? UnknownFieldHandler.onRead : u)(this.info.typeName, message, fieldNo, wireType, d);
					continue;
				}
				let target = message, repeated = field.repeat, localName = field.localName;
				if (field.oneof) {
					target = target[field.oneof];
					if (target.oneofKind !== localName) target = message[field.oneof] = { oneofKind: localName };
				}
				switch (field.kind) {
					case "scalar":
					case "enum":
						let T = field.kind == "enum" ? ScalarType.INT32 : field.T;
						let L = field.kind == "scalar" ? field.L : undefined;
						if (repeated) {
							let arr = target[localName];
							if (wireType == WireType.LengthDelimited && T != ScalarType.STRING && T != ScalarType.BYTES) {
								let e = reader.uint32() + reader.pos;
								while (reader.pos < e) arr.push(this.scalar(reader, T, L));
							} else arr.push(this.scalar(reader, T, L));
						} else target[localName] = this.scalar(reader, T, L);
						break;
					case "message":
						if (repeated) {
							let arr = target[localName];
							let msg = field.T().internalBinaryRead(reader, reader.uint32(), options);
							arr.push(msg);
						} else target[localName] = field.T().internalBinaryRead(reader, reader.uint32(), options, target[localName]);
						break;
					case "map":
						let [mapKey, mapVal] = this.mapEntry(field, reader, options);
						target[localName][mapKey] = mapVal;
						break;
				}
			}
		}
		/**
		* Read a map field, expecting key field = 1, value field = 2
		*/
		mapEntry(field, reader, options) {
			let length = reader.uint32();
			let end = reader.pos + length;
			let key = undefined;
			let val = undefined;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						if (field.K == ScalarType.BOOL) key = reader.bool().toString();
else key = this.scalar(reader, field.K, LongType.STRING);
						break;
					case 2:
						switch (field.V.kind) {
							case "scalar":
								val = this.scalar(reader, field.V.T, field.V.L);
								break;
							case "enum":
								val = reader.int32();
								break;
							case "message":
								val = field.V.T().internalBinaryRead(reader, reader.uint32(), options);
								break;
						}
						break;
					default: throw new Error(`Unknown field ${fieldNo} (wire type ${wireType}) in map entry for ${this.info.typeName}#${field.name}`);
				}
			}
			if (key === undefined) {
				let keyRaw = reflectionScalarDefault(field.K);
				key = field.K == ScalarType.BOOL ? keyRaw.toString() : keyRaw;
			}
			if (val === undefined) switch (field.V.kind) {
				case "scalar":
					val = reflectionScalarDefault(field.V.T, field.V.L);
					break;
				case "enum":
					val = 0;
					break;
				case "message":
					val = field.V.T().create();
					break;
			}
			return [key, val];
		}
		scalar(reader, type, longType) {
			switch (type) {
				case ScalarType.INT32: return reader.int32();
				case ScalarType.STRING: return reader.string();
				case ScalarType.BOOL: return reader.bool();
				case ScalarType.DOUBLE: return reader.double();
				case ScalarType.FLOAT: return reader.float();
				case ScalarType.INT64: return reflectionLongConvert(reader.int64(), longType);
				case ScalarType.UINT64: return reflectionLongConvert(reader.uint64(), longType);
				case ScalarType.FIXED64: return reflectionLongConvert(reader.fixed64(), longType);
				case ScalarType.FIXED32: return reader.fixed32();
				case ScalarType.BYTES: return reader.bytes();
				case ScalarType.UINT32: return reader.uint32();
				case ScalarType.SFIXED32: return reader.sfixed32();
				case ScalarType.SFIXED64: return reflectionLongConvert(reader.sfixed64(), longType);
				case ScalarType.SINT32: return reader.sint32();
				case ScalarType.SINT64: return reflectionLongConvert(reader.sint64(), longType);
			}
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-binary-writer.js
var ReflectionBinaryWriter;
var init_reflection_binary_writer = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-binary-writer.js"() {
	init_binary_format_contract();
	init_reflection_info();
	init_assert();
	init_pb_long();
	ReflectionBinaryWriter = class {
		constructor(info) {
			this.info = info;
		}
		prepare() {
			if (!this.fields) {
				const fieldsInput = this.info.fields ? this.info.fields.concat() : [];
				this.fields = fieldsInput.sort((a, b) => a.no - b.no);
			}
		}
		/**
		* Writes the message to binary format.
		*/
		write(message, writer, options) {
			this.prepare();
			for (const field of this.fields) {
				let value, emitDefault, repeated = field.repeat, localName = field.localName;
				if (field.oneof) {
					const group = message[field.oneof];
					if (group.oneofKind !== localName) continue;
					value = group[localName];
					emitDefault = true;
				} else {
					value = message[localName];
					emitDefault = false;
				}
				switch (field.kind) {
					case "scalar":
					case "enum":
						let T = field.kind == "enum" ? ScalarType.INT32 : field.T;
						if (repeated) {
							assert(Array.isArray(value));
							if (repeated == RepeatType.PACKED) this.packed(writer, T, field.no, value);
else for (const item of value) this.scalar(writer, T, field.no, item, true);
						} else if (value === undefined) assert(field.opt);
else this.scalar(writer, T, field.no, value, emitDefault || field.opt);
						break;
					case "message":
						if (repeated) {
							assert(Array.isArray(value));
							for (const item of value) this.message(writer, options, field.T(), field.no, item);
						} else this.message(writer, options, field.T(), field.no, value);
						break;
					case "map":
						assert(typeof value == "object" && value !== null);
						for (const [key, val] of Object.entries(value)) this.mapEntry(writer, options, field, key, val);
						break;
				}
			}
			let u = options.writeUnknownFields;
			if (u !== false) (u === true ? UnknownFieldHandler.onWrite : u)(this.info.typeName, message, writer);
		}
		mapEntry(writer, options, field, key, value) {
			writer.tag(field.no, WireType.LengthDelimited);
			writer.fork();
			let keyValue = key;
			switch (field.K) {
				case ScalarType.INT32:
				case ScalarType.FIXED32:
				case ScalarType.UINT32:
				case ScalarType.SFIXED32:
				case ScalarType.SINT32:
					keyValue = Number.parseInt(key);
					break;
				case ScalarType.BOOL:
					assert(key == "true" || key == "false");
					keyValue = key == "true";
					break;
			}
			this.scalar(writer, field.K, 1, keyValue, true);
			switch (field.V.kind) {
				case "scalar":
					this.scalar(writer, field.V.T, 2, value, true);
					break;
				case "enum":
					this.scalar(writer, ScalarType.INT32, 2, value, true);
					break;
				case "message":
					this.message(writer, options, field.V.T(), 2, value);
					break;
			}
			writer.join();
		}
		message(writer, options, handler, fieldNo, value) {
			if (value === undefined) return;
			handler.internalBinaryWrite(value, writer.tag(fieldNo, WireType.LengthDelimited).fork(), options);
			writer.join();
		}
		/**
		* Write a single scalar value.
		*/
		scalar(writer, type, fieldNo, value, emitDefault) {
			let [wireType, method, isDefault] = this.scalarInfo(type, value);
			if (!isDefault || emitDefault) {
				writer.tag(fieldNo, wireType);
				writer[method](value);
			}
		}
		/**
		* Write an array of scalar values in packed format.
		*/
		packed(writer, type, fieldNo, value) {
			if (!value.length) return;
			assert(type !== ScalarType.BYTES && type !== ScalarType.STRING);
			writer.tag(fieldNo, WireType.LengthDelimited);
			writer.fork();
			let [, method] = this.scalarInfo(type);
			for (let i = 0; i < value.length; i++) writer[method](value[i]);
			writer.join();
		}
		/**
		* Get information for writing a scalar value.
		*
		* Returns tuple:
		* [0]: appropriate WireType
		* [1]: name of the appropriate method of IBinaryWriter
		* [2]: whether the given value is a default value
		*
		* If argument `value` is omitted, [2] is always false.
		*/
		scalarInfo(type, value) {
			let t = WireType.Varint;
			let m;
			let i = value === undefined;
			let d = value === 0;
			switch (type) {
				case ScalarType.INT32:
					m = "int32";
					break;
				case ScalarType.STRING:
					d = i || !value.length;
					t = WireType.LengthDelimited;
					m = "string";
					break;
				case ScalarType.BOOL:
					d = value === false;
					m = "bool";
					break;
				case ScalarType.UINT32:
					m = "uint32";
					break;
				case ScalarType.DOUBLE:
					t = WireType.Bit64;
					m = "double";
					break;
				case ScalarType.FLOAT:
					t = WireType.Bit32;
					m = "float";
					break;
				case ScalarType.INT64:
					d = i || PbLong.from(value).isZero();
					m = "int64";
					break;
				case ScalarType.UINT64:
					d = i || PbULong.from(value).isZero();
					m = "uint64";
					break;
				case ScalarType.FIXED64:
					d = i || PbULong.from(value).isZero();
					t = WireType.Bit64;
					m = "fixed64";
					break;
				case ScalarType.BYTES:
					d = i || !value.byteLength;
					t = WireType.LengthDelimited;
					m = "bytes";
					break;
				case ScalarType.FIXED32:
					t = WireType.Bit32;
					m = "fixed32";
					break;
				case ScalarType.SFIXED32:
					t = WireType.Bit32;
					m = "sfixed32";
					break;
				case ScalarType.SFIXED64:
					d = i || PbLong.from(value).isZero();
					t = WireType.Bit64;
					m = "sfixed64";
					break;
				case ScalarType.SINT32:
					m = "sint32";
					break;
				case ScalarType.SINT64:
					d = i || PbLong.from(value).isZero();
					m = "sint64";
					break;
			}
			return [
				t,
				m,
				i || d
			];
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-json-reader.js
var ReflectionJsonReader;
var init_reflection_json_reader = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-json-reader.js"() {
	init_json_typings();
	init_base64();
	init_reflection_info();
	init_pb_long();
	init_assert();
	init_reflection_long_convert();
	ReflectionJsonReader = class {
		constructor(info) {
			this.info = info;
		}
		prepare() {
			var _a;
			if (this.fMap === undefined) {
				this.fMap = {};
				const fieldsInput = (_a = this.info.fields) !== null && _a !== void 0 ? _a : [];
				for (const field of fieldsInput) {
					this.fMap[field.name] = field;
					this.fMap[field.jsonName] = field;
					this.fMap[field.localName] = field;
				}
			}
		}
		assert(condition, fieldName, jsonValue) {
			if (!condition) {
				let what = typeofJsonValue(jsonValue);
				if (what == "number" || what == "boolean") what = jsonValue.toString();
				throw new Error(`Cannot parse JSON ${what} for ${this.info.typeName}#${fieldName}`);
			}
		}
		/**
		* Reads a message from canonical JSON format into the target message.
		*
		* Repeated fields are appended. Map entries are added, overwriting
		* existing keys.
		*
		* If a message field is already present, it will be merged with the
		* new data.
		*/
		read(input, message, options) {
			this.prepare();
			const oneofsHandled = [];
			for (const [jsonKey, jsonValue] of Object.entries(input)) {
				const field = this.fMap[jsonKey];
				if (!field) {
					if (!options.ignoreUnknownFields) throw new Error(`Found unknown field while reading ${this.info.typeName} from JSON format. JSON key: ${jsonKey}`);
					continue;
				}
				const localName = field.localName;
				let target;
				if (field.oneof) {
					if (jsonValue === null && (field.kind !== "enum" || field.T()[0] !== "google.protobuf.NullValue")) continue;
					if (oneofsHandled.includes(field.oneof)) throw new Error(`Multiple members of the oneof group "${field.oneof}" of ${this.info.typeName} are present in JSON.`);
					oneofsHandled.push(field.oneof);
					target = message[field.oneof] = { oneofKind: localName };
				} else target = message;
				if (field.kind == "map") {
					if (jsonValue === null) continue;
					this.assert(isJsonObject(jsonValue), field.name, jsonValue);
					const fieldObj = target[localName];
					for (const [jsonObjKey, jsonObjValue] of Object.entries(jsonValue)) {
						this.assert(jsonObjValue !== null, field.name + " map value", null);
						let val;
						switch (field.V.kind) {
							case "message":
								val = field.V.T().internalJsonRead(jsonObjValue, options);
								break;
							case "enum":
								val = this.enum(field.V.T(), jsonObjValue, field.name, options.ignoreUnknownFields);
								if (val === false) continue;
								break;
							case "scalar":
								val = this.scalar(jsonObjValue, field.V.T, field.V.L, field.name);
								break;
						}
						this.assert(val !== undefined, field.name + " map value", jsonObjValue);
						let key = jsonObjKey;
						if (field.K == ScalarType.BOOL) key = key == "true" ? true : key == "false" ? false : key;
						key = this.scalar(key, field.K, LongType.STRING, field.name).toString();
						fieldObj[key] = val;
					}
				} else if (field.repeat) {
					if (jsonValue === null) continue;
					this.assert(Array.isArray(jsonValue), field.name, jsonValue);
					const fieldArr = target[localName];
					for (const jsonItem of jsonValue) {
						this.assert(jsonItem !== null, field.name, null);
						let val;
						switch (field.kind) {
							case "message":
								val = field.T().internalJsonRead(jsonItem, options);
								break;
							case "enum":
								val = this.enum(field.T(), jsonItem, field.name, options.ignoreUnknownFields);
								if (val === false) continue;
								break;
							case "scalar":
								val = this.scalar(jsonItem, field.T, field.L, field.name);
								break;
						}
						this.assert(val !== undefined, field.name, jsonValue);
						fieldArr.push(val);
					}
				} else switch (field.kind) {
					case "message":
						if (jsonValue === null && field.T().typeName != "google.protobuf.Value") {
							this.assert(field.oneof === undefined, field.name + " (oneof member)", null);
							continue;
						}
						target[localName] = field.T().internalJsonRead(jsonValue, options, target[localName]);
						break;
					case "enum":
						if (jsonValue === null) continue;
						let val = this.enum(field.T(), jsonValue, field.name, options.ignoreUnknownFields);
						if (val === false) continue;
						target[localName] = val;
						break;
					case "scalar":
						if (jsonValue === null) continue;
						target[localName] = this.scalar(jsonValue, field.T, field.L, field.name);
						break;
				}
			}
		}
		/**
		* Returns `false` for unrecognized string representations.
		*
		* google.protobuf.NullValue accepts only JSON `null` (or the old `"NULL_VALUE"`).
		*/
		enum(type, json, fieldName, ignoreUnknownFields) {
			if (type[0] == "google.protobuf.NullValue") assert(json === null || json === "NULL_VALUE", `Unable to parse field ${this.info.typeName}#${fieldName}, enum ${type[0]} only accepts null.`);
			if (json === null) return 0;
			switch (typeof json) {
				case "number":
					assert(Number.isInteger(json), `Unable to parse field ${this.info.typeName}#${fieldName}, enum can only be integral number, got ${json}.`);
					return json;
				case "string":
					let localEnumName = json;
					if (type[2] && json.substring(0, type[2].length) === type[2]) localEnumName = json.substring(type[2].length);
					let enumNumber = type[1][localEnumName];
					if (typeof enumNumber === "undefined" && ignoreUnknownFields) return false;
					assert(typeof enumNumber == "number", `Unable to parse field ${this.info.typeName}#${fieldName}, enum ${type[0]} has no value for "${json}".`);
					return enumNumber;
			}
			assert(false, `Unable to parse field ${this.info.typeName}#${fieldName}, cannot parse enum value from ${typeof json}".`);
		}
		scalar(json, type, longType, fieldName) {
			let e;
			try {
				switch (type) {
					case ScalarType.DOUBLE:
					case ScalarType.FLOAT:
						if (json === null) return 0;
						if (json === "NaN") return Number.NaN;
						if (json === "Infinity") return Number.POSITIVE_INFINITY;
						if (json === "-Infinity") return Number.NEGATIVE_INFINITY;
						if (json === "") {
							e = "empty string";
							break;
						}
						if (typeof json == "string" && json.trim().length !== json.length) {
							e = "extra whitespace";
							break;
						}
						if (typeof json != "string" && typeof json != "number") break;
						let float = Number(json);
						if (Number.isNaN(float)) {
							e = "not a number";
							break;
						}
						if (!Number.isFinite(float)) {
							e = "too large or small";
							break;
						}
						if (type == ScalarType.FLOAT) assertFloat32(float);
						return float;
					case ScalarType.INT32:
					case ScalarType.FIXED32:
					case ScalarType.SFIXED32:
					case ScalarType.SINT32:
					case ScalarType.UINT32:
						if (json === null) return 0;
						let int32;
						if (typeof json == "number") int32 = json;
else if (json === "") e = "empty string";
else if (typeof json == "string") if (json.trim().length !== json.length) e = "extra whitespace";
else int32 = Number(json);
						if (int32 === undefined) break;
						if (type == ScalarType.UINT32) assertUInt32(int32);
else assertInt32(int32);
						return int32;
					case ScalarType.INT64:
					case ScalarType.SFIXED64:
					case ScalarType.SINT64:
						if (json === null) return reflectionLongConvert(PbLong.ZERO, longType);
						if (typeof json != "number" && typeof json != "string") break;
						return reflectionLongConvert(PbLong.from(json), longType);
					case ScalarType.FIXED64:
					case ScalarType.UINT64:
						if (json === null) return reflectionLongConvert(PbULong.ZERO, longType);
						if (typeof json != "number" && typeof json != "string") break;
						return reflectionLongConvert(PbULong.from(json), longType);
					case ScalarType.BOOL:
						if (json === null) return false;
						if (typeof json !== "boolean") break;
						return json;
					case ScalarType.STRING:
						if (json === null) return "";
						if (typeof json !== "string") {
							e = "extra whitespace";
							break;
						}
						try {
							encodeURIComponent(json);
						} catch (e$1) {
							e$1 = "invalid UTF8";
							break;
						}
						return json;
					case ScalarType.BYTES:
						if (json === null || json === "") return new Uint8Array(0);
						if (typeof json !== "string") break;
						return base64decode(json);
				}
			} catch (error) {
				e = error.message;
			}
			this.assert(false, fieldName + (e ? " - " + e : ""), json);
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/index.js
var require_dist = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/index.js"(exports) {
	var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
		if (k2 === undefined) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	} : function(o, m, k, k2) {
		if (k2 === undefined) k2 = k;
		o[k2] = m[k];
	});
	var __exportStar = exports && exports.__exportStar || function(m, exports$1) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p)) __createBinding(exports$1, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	const runtime_1$2 = (init_es2015(), __toCommonJS(es2015_exports));
	/**
	* Supports both node and web environments, replacement of previous Buffer.from() being node-only.
	* This is specific to this package's usage, and not a replacement of Buffer.from() altogether
	*/
	const compatBuffer = {
		from: function(input, encoding) {
			if (typeof input === "string" && encoding === "base64") {
				const encodedBytes = atob(input);
				const bytes = new Uint8Array(encodedBytes.length);
				for (let i = 0; i < encodedBytes.length; i++) bytes[i] = encodedBytes.charCodeAt(i);
				return bytes;
			} else if (!encoding && input instanceof Uint8Array) return input;
			throw new Error("Invalid input type.");
		},
		toBase64String: function(buffer) {
			let encodedBytes = "";
			for (let i = 0; i < buffer.length; i++) encodedBytes += String.fromCharCode(buffer[i]);
			return btoa(encodedBytes);
		}
	};
	function toBase64(data) {
		return compatBuffer.toBase64String(compatBuffer.from(this.toBinary(data)));
	}
	function fromBase64(base64) {
		return this.fromBinary(compatBuffer.from(base64, "base64"));
	}
	runtime_1$2.MessageType.prototype.fromBase64 = fromBase64;
	runtime_1$2.MessageType.prototype.toBase64 = toBase64;
	__exportStar(require_User(), exports);
	__exportStar(require_MediumUser(), exports);
	__exportStar(require_UserData(), exports);
	__exportStar(require_GuildShardingConfig(), exports);
	__exportStar(require_PreloadedUserSettings(), exports);
	__exportStar(require_FrecencyUserSettings(), exports);
	__exportStar(require_Experiment(), exports);
	__exportStar(require_ApplicationUserRoleConnection(), exports);
	__exportStar(require_AcknowledgedApplicationDisclosures(), exports);
	__exportStar(require_PremiumMarketingComponentProperties(), exports);
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-contains-message-type.js
function containsMessageType(msg) {
	return msg[MESSAGE_TYPE] != null;
}
var init_reflection_contains_message_type = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-contains-message-type.js"() {
	init_message_type_contract();
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/oneof.js
function isOneofGroup(any) {
	if (typeof any != "object" || any === null || !any.hasOwnProperty("oneofKind")) return false;
	switch (typeof any.oneofKind) {
		case "string":
			if (any[any.oneofKind] === undefined) return false;
			return Object.keys(any).length == 2;
		case "undefined": return Object.keys(any).length == 1;
		default: return false;
	}
}
function getOneofValue(oneof, kind) {
	return oneof[kind];
}
function setOneofValue(oneof, kind, value) {
	if (oneof.oneofKind !== undefined) delete oneof[oneof.oneofKind];
	oneof.oneofKind = kind;
	if (value !== undefined) oneof[kind] = value;
}
function clearOneofValue(oneof) {
	if (oneof.oneofKind !== undefined) delete oneof[oneof.oneofKind];
	oneof.oneofKind = undefined;
}
function getSelectedOneofValue(oneof) {
	if (oneof.oneofKind === undefined) return undefined;
	return oneof[oneof.oneofKind];
}
var init_oneof = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/oneof.js"() {} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/enum-object.js
function isEnumObject(arg) {
	if (typeof arg != "object" || arg === null) return false;
	if (!arg.hasOwnProperty(0)) return false;
	for (let k of Object.keys(arg)) {
		let num = parseInt(k);
		if (!Number.isNaN(num)) {
			let nam = arg[num];
			if (nam === undefined) return false;
			if (arg[nam] !== num) return false;
		} else {
			let num$1 = arg[k];
			if (num$1 === undefined) return false;
			if (typeof num$1 !== "number") return false;
			if (arg[num$1] === undefined) return false;
		}
	}
	return true;
}
function listEnumValues(enumObject) {
	if (!isEnumObject(enumObject)) throw new Error("not a typescript enum object");
	let values = [];
	for (let [name, number] of Object.entries(enumObject)) if (typeof number == "number") values.push({
		name,
		number
	});
	return values;
}
function listEnumNames(enumObject) {
	return listEnumValues(enumObject).map((val) => val.name);
}
function listEnumNumbers(enumObject) {
	return listEnumValues(enumObject).map((val) => val.number).filter((num, index, arr) => arr.indexOf(num) == index);
}
var init_enum_object = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/enum-object.js"() {} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/lower-camel-case.js
function lowerCamelCase(snakeCase) {
	let capNext = false;
	const sb = [];
	for (let i = 0; i < snakeCase.length; i++) {
		let next = snakeCase.charAt(i);
		if (next == "_") capNext = true;
else if (/\d/.test(next)) {
			sb.push(next);
			capNext = true;
		} else if (capNext) {
			sb.push(next.toUpperCase());
			capNext = false;
		} else if (i == 0) sb.push(next.toLowerCase());
else sb.push(next);
	}
	return sb.join("");
}
var init_lower_camel_case = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/lower-camel-case.js"() {} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/assert.js
function assert(condition, msg) {
	if (!condition) throw new Error(msg);
}
function assertNever(value, msg) {
	throw new Error(msg !== null && msg !== void 0 ? msg : "Unexpected object: " + value);
}
function assertInt32(arg) {
	if (typeof arg !== "number") throw new Error("invalid int 32: " + typeof arg);
	if (!Number.isInteger(arg) || arg > INT32_MAX || arg < INT32_MIN) throw new Error("invalid int 32: " + arg);
}
function assertUInt32(arg) {
	if (typeof arg !== "number") throw new Error("invalid uint 32: " + typeof arg);
	if (!Number.isInteger(arg) || arg > UINT32_MAX || arg < 0) throw new Error("invalid uint 32: " + arg);
}
function assertFloat32(arg) {
	if (typeof arg !== "number") throw new Error("invalid float 32: " + typeof arg);
	if (!Number.isFinite(arg)) return;
	if (arg > FLOAT32_MAX || arg < FLOAT32_MIN) throw new Error("invalid float 32: " + arg);
}
var FLOAT32_MAX, FLOAT32_MIN, UINT32_MAX, INT32_MAX, INT32_MIN;
var init_assert = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/assert.js"() {
	FLOAT32_MAX = 34028234663852886e22, FLOAT32_MIN = -34028234663852886e22, UINT32_MAX = 4294967295, INT32_MAX = 2147483647, INT32_MIN = -2147483648;
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/google/protobuf/timestamp.js
var require_timestamp = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/google/protobuf/timestamp.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Timestamp = void 0;
	const runtime_1$1 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2$1 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3$1 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4$1 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_5$1 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_6$1 = (init_es2015(), __toCommonJS(es2015_exports));
	var Timestamp$Type = class extends runtime_6$1.MessageType {
		constructor() {
			super("google.protobuf.Timestamp", [{
				no: 1,
				name: "seconds",
				kind: "scalar",
				T: 3,
				L: 0
			}, {
				no: 2,
				name: "nanos",
				kind: "scalar",
				T: 5
			}]);
		}
		/**
		* Creates a new `Timestamp` for the current time.
		*/
		now() {
			const msg = this.create();
			const ms = Date.now();
			msg.seconds = runtime_5$1.PbLong.from(Math.floor(ms / 1e3)).toBigInt();
			msg.nanos = ms % 1e3 * 1e6;
			return msg;
		}
		/**
		* Converts a `Timestamp` to a JavaScript Date.
		*/
		toDate(message) {
			return new Date(runtime_5$1.PbLong.from(message.seconds).toNumber() * 1e3 + Math.ceil(message.nanos / 1e6));
		}
		/**
		* Converts a JavaScript Date to a `Timestamp`.
		*/
		fromDate(date) {
			const msg = this.create();
			const ms = date.getTime();
			msg.seconds = runtime_5$1.PbLong.from(Math.floor(ms / 1e3)).toBigInt();
			msg.nanos = (ms % 1e3 + (ms < 0 && ms % 1e3 !== 0 ? 1e3 : 0)) * 1e6;
			return msg;
		}
		/**
		* In JSON format, the `Timestamp` type is encoded as a string
		* in the RFC 3339 format.
		*/
		internalJsonWrite(message, options) {
			let ms = runtime_5$1.PbLong.from(message.seconds).toNumber() * 1e3;
			if (ms < Date.parse("0001-01-01T00:00:00Z") || ms > Date.parse("9999-12-31T23:59:59Z")) throw new Error("Unable to encode Timestamp to JSON. Must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive.");
			if (message.nanos < 0) throw new Error("Unable to encode invalid Timestamp to JSON. Nanos must not be negative.");
			let z = "Z";
			if (message.nanos > 0) {
				let nanosStr = (message.nanos + 1e9).toString().substring(1);
				if (nanosStr.substring(3) === "000000") z = "." + nanosStr.substring(0, 3) + "Z";
else if (nanosStr.substring(6) === "000") z = "." + nanosStr.substring(0, 6) + "Z";
else z = "." + nanosStr + "Z";
			}
			return new Date(ms).toISOString().replace(".000Z", z);
		}
		/**
		* In JSON format, the `Timestamp` type is encoded as a string
		* in the RFC 3339 format.
		*/
		internalJsonRead(json, options, target) {
			if (typeof json !== "string") throw new Error("Unable to parse Timestamp from JSON " + (0, runtime_4$1.typeofJsonValue)(json) + ".");
			let matches = json.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:Z|\.([0-9]{3,9})Z|([+-][0-9][0-9]:[0-9][0-9]))$/);
			if (!matches) throw new Error("Unable to parse Timestamp from JSON. Invalid format.");
			let ms = Date.parse(matches[1] + "-" + matches[2] + "-" + matches[3] + "T" + matches[4] + ":" + matches[5] + ":" + matches[6] + (matches[8] ? matches[8] : "Z"));
			if (Number.isNaN(ms)) throw new Error("Unable to parse Timestamp from JSON. Invalid value.");
			if (ms < Date.parse("0001-01-01T00:00:00Z") || ms > Date.parse("9999-12-31T23:59:59Z")) throw new globalThis.Error("Unable to parse Timestamp from JSON. Must be from 0001-01-01T00:00:00Z to 9999-12-31T23:59:59Z inclusive.");
			if (!target) target = this.create();
			target.seconds = runtime_5$1.PbLong.from(ms / 1e3).toBigInt();
			target.nanos = 0;
			if (matches[7]) target.nanos = parseInt("1" + matches[7] + "0".repeat(9 - matches[7].length)) - 1e9;
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.seconds = 0n;
			message.nanos = 0;
			if (value !== undefined) (0, runtime_3$1.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.seconds = reader.int64().toBigInt();
						break;
					case 2:
						message.nanos = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_2$1.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.seconds !== 0n) writer.tag(1, runtime_1$1.WireType.Varint).int64(message.seconds);
			if (message.nanos !== 0) writer.tag(2, runtime_1$1.WireType.Varint).int32(message.nanos);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_2$1.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.Timestamp
	*/
	exports.Timestamp = new Timestamp$Type();
} });

//#endregion
//#region node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/google/protobuf/wrappers.js
var require_wrappers = __commonJS({ "node_modules/.pnpm/discord-protos@1.2.82/node_modules/discord-protos/dist/discord_protos/google/protobuf/wrappers.js"(exports) {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.BytesValue = exports.StringValue = exports.BoolValue = exports.UInt32Value = exports.Int32Value = exports.UInt64Value = exports.Int64Value = exports.FloatValue = exports.DoubleValue = void 0;
	const runtime_1 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_2 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_3 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_4 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_5 = (init_es2015(), __toCommonJS(es2015_exports));
	const runtime_6 = (init_es2015(), __toCommonJS(es2015_exports));
	var DoubleValue$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.DoubleValue", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 1
			}]);
		}
		/**
		* Encode `DoubleValue` to JSON number.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.scalar(2, message.value, "value", false, true);
		}
		/**
		* Decode `DoubleValue` from JSON number.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, 1, undefined, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = 0;
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.double();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== 0) writer.tag(1, runtime_3.WireType.Bit64).double(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.DoubleValue
	*/
	exports.DoubleValue = new DoubleValue$Type();
	var FloatValue$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.FloatValue", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 2
			}]);
		}
		/**
		* Encode `FloatValue` to JSON number.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.scalar(1, message.value, "value", false, true);
		}
		/**
		* Decode `FloatValue` from JSON number.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, 1, undefined, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = 0;
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.float();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== 0) writer.tag(1, runtime_3.WireType.Bit32).float(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.FloatValue
	*/
	exports.FloatValue = new FloatValue$Type();
	var Int64Value$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.Int64Value", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 3,
				L: 0
			}]);
		}
		/**
		* Encode `Int64Value` to JSON string.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.scalar(runtime_1.ScalarType.INT64, message.value, "value", false, true);
		}
		/**
		* Decode `Int64Value` from JSON string.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, runtime_1.ScalarType.INT64, runtime_2.LongType.BIGINT, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = 0n;
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.int64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== 0n) writer.tag(1, runtime_3.WireType.Varint).int64(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.Int64Value
	*/
	exports.Int64Value = new Int64Value$Type();
	var UInt64Value$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.UInt64Value", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 4,
				L: 0
			}]);
		}
		/**
		* Encode `UInt64Value` to JSON string.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.scalar(runtime_1.ScalarType.UINT64, message.value, "value", false, true);
		}
		/**
		* Decode `UInt64Value` from JSON string.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, runtime_1.ScalarType.UINT64, runtime_2.LongType.BIGINT, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = 0n;
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.uint64().toBigInt();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== 0n) writer.tag(1, runtime_3.WireType.Varint).uint64(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.UInt64Value
	*/
	exports.UInt64Value = new UInt64Value$Type();
	var Int32Value$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.Int32Value", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 5
			}]);
		}
		/**
		* Encode `Int32Value` to JSON string.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.scalar(5, message.value, "value", false, true);
		}
		/**
		* Decode `Int32Value` from JSON string.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, 5, undefined, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = 0;
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.int32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== 0) writer.tag(1, runtime_3.WireType.Varint).int32(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.Int32Value
	*/
	exports.Int32Value = new Int32Value$Type();
	var UInt32Value$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.UInt32Value", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 13
			}]);
		}
		/**
		* Encode `UInt32Value` to JSON string.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.scalar(13, message.value, "value", false, true);
		}
		/**
		* Decode `UInt32Value` from JSON string.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, 13, undefined, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = 0;
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.uint32();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== 0) writer.tag(1, runtime_3.WireType.Varint).uint32(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.UInt32Value
	*/
	exports.UInt32Value = new UInt32Value$Type();
	var BoolValue$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.BoolValue", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 8
			}]);
		}
		/**
		* Encode `BoolValue` to JSON bool.
		*/
		internalJsonWrite(message, options) {
			return message.value;
		}
		/**
		* Decode `BoolValue` from JSON bool.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, 8, undefined, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = false;
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.bool();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== false) writer.tag(1, runtime_3.WireType.Varint).bool(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.BoolValue
	*/
	exports.BoolValue = new BoolValue$Type();
	var StringValue$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.StringValue", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 9
			}]);
		}
		/**
		* Encode `StringValue` to JSON string.
		*/
		internalJsonWrite(message, options) {
			return message.value;
		}
		/**
		* Decode `StringValue` from JSON string.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, 9, undefined, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = "";
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.string();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value !== "") writer.tag(1, runtime_3.WireType.LengthDelimited).string(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.StringValue
	*/
	exports.StringValue = new StringValue$Type();
	var BytesValue$Type = class extends runtime_6.MessageType {
		constructor() {
			super("google.protobuf.BytesValue", [{
				no: 1,
				name: "value",
				kind: "scalar",
				T: 12
			}]);
		}
		/**
		* Encode `BytesValue` to JSON string.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.scalar(12, message.value, "value", false, true);
		}
		/**
		* Decode `BytesValue` from JSON string.
		*/
		internalJsonRead(json, options, target) {
			if (!target) target = this.create();
			target.value = this.refJsonReader.scalar(json, 12, undefined, "value");
			return target;
		}
		create(value) {
			const message = globalThis.Object.create(this.messagePrototype);
			message.value = new Uint8Array(0);
			if (value !== undefined) (0, runtime_5.reflectionMergePartial)(this, message, value);
			return message;
		}
		internalBinaryRead(reader, length, options, target) {
			let message = target ?? this.create(), end = reader.pos + length;
			while (reader.pos < end) {
				let [fieldNo, wireType] = reader.tag();
				switch (fieldNo) {
					case 1:
						message.value = reader.bytes();
						break;
					default:
						let u = options.readUnknownField;
						if (u === "throw") throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
						let d = reader.skip(wireType);
						if (u !== false) (u === true ? runtime_4.UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
				}
			}
			return message;
		}
		internalBinaryWrite(message, writer, options) {
			if (message.value.length) writer.tag(1, runtime_3.WireType.LengthDelimited).bytes(message.value);
			let u = options.writeUnknownFields;
			if (u !== false) (u == true ? runtime_4.UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
			return writer;
		}
	};
	/**
	* @generated MessageType for protobuf message google.protobuf.BytesValue
	*/
	exports.BytesValue = new BytesValue$Type();
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-long-convert.js
function reflectionLongConvert(long, type) {
	switch (type) {
		case LongType.BIGINT: return long.toBigInt();
		case LongType.NUMBER: return long.toNumber();
		default: return long.toString();
	}
}
var init_reflection_long_convert = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/reflection-long-convert.js"() {
	init_reflection_info();
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/goog-varint.js
function varint64read() {
	let lowBits = 0;
	let highBits = 0;
	for (let shift = 0; shift < 28; shift += 7) {
		let b = this.buf[this.pos++];
		lowBits |= (b & 127) << shift;
		if ((b & 128) == 0) {
			this.assertBounds();
			return [lowBits, highBits];
		}
	}
	let middleByte = this.buf[this.pos++];
	lowBits |= (middleByte & 15) << 28;
	highBits = (middleByte & 112) >> 4;
	if ((middleByte & 128) == 0) {
		this.assertBounds();
		return [lowBits, highBits];
	}
	for (let shift = 3; shift <= 31; shift += 7) {
		let b = this.buf[this.pos++];
		highBits |= (b & 127) << shift;
		if ((b & 128) == 0) {
			this.assertBounds();
			return [lowBits, highBits];
		}
	}
	throw new Error("invalid varint");
}
function varint64write(lo, hi, bytes) {
	for (let i = 0; i < 28; i = i + 7) {
		const shift = lo >>> i;
		const hasNext = !(shift >>> 7 == 0 && hi == 0);
		const byte = (hasNext ? shift | 128 : shift) & 255;
		bytes.push(byte);
		if (!hasNext) return;
	}
	const splitBits = lo >>> 28 & 15 | (hi & 7) << 4;
	const hasMoreBits = !(hi >> 3 == 0);
	bytes.push((hasMoreBits ? splitBits | 128 : splitBits) & 255);
	if (!hasMoreBits) return;
	for (let i = 3; i < 31; i = i + 7) {
		const shift = hi >>> i;
		const hasNext = !(shift >>> 7 == 0);
		const byte = (hasNext ? shift | 128 : shift) & 255;
		bytes.push(byte);
		if (!hasNext) return;
	}
	bytes.push(hi >>> 31 & 1);
}
function int64fromString(dec) {
	let minus = dec[0] == "-";
	if (minus) dec = dec.slice(1);
	const base = 1e6;
	let lowBits = 0;
	let highBits = 0;
	function add1e6digit(begin, end) {
		const digit1e6 = Number(dec.slice(begin, end));
		highBits *= base;
		lowBits = lowBits * base + digit1e6;
		if (lowBits >= TWO_PWR_32_DBL) {
			highBits = highBits + (lowBits / TWO_PWR_32_DBL | 0);
			lowBits = lowBits % TWO_PWR_32_DBL;
		}
	}
	add1e6digit(-24, -18);
	add1e6digit(-18, -12);
	add1e6digit(-12, -6);
	add1e6digit(-6);
	return [
		minus,
		lowBits,
		highBits
	];
}
function int64toString(bitsLow, bitsHigh) {
	if (bitsHigh >>> 0 <= 2097151) return "" + (TWO_PWR_32_DBL * bitsHigh + (bitsLow >>> 0));
	let low = bitsLow & 16777215;
	let mid = (bitsLow >>> 24 | bitsHigh << 8) >>> 0 & 16777215;
	let high = bitsHigh >> 16 & 65535;
	let digitA = low + mid * 6777216 + high * 6710656;
	let digitB = mid + high * 8147497;
	let digitC = high * 2;
	let base = 1e7;
	if (digitA >= base) {
		digitB += Math.floor(digitA / base);
		digitA %= base;
	}
	if (digitB >= base) {
		digitC += Math.floor(digitB / base);
		digitB %= base;
	}
	function decimalFrom1e7(digit1e7, needLeadingZeros) {
		let partial = digit1e7 ? String(digit1e7) : "";
		if (needLeadingZeros) return "0000000".slice(partial.length) + partial;
		return partial;
	}
	return decimalFrom1e7(
		digitC,
		/*needLeadingZeros=*/
		0
) + decimalFrom1e7(
		digitB,
		/*needLeadingZeros=*/
		digitC
) + decimalFrom1e7(
		digitA,
		/*needLeadingZeros=*/
		1
);
}
function varint32write(value, bytes) {
	if (value >= 0) {
		while (value > 127) {
			bytes.push(value & 127 | 128);
			value = value >>> 7;
		}
		bytes.push(value);
	} else {
		for (let i = 0; i < 9; i++) {
			bytes.push(value & 127 | 128);
			value = value >> 7;
		}
		bytes.push(1);
	}
}
function varint32read() {
	let b = this.buf[this.pos++];
	let result = b & 127;
	if ((b & 128) == 0) {
		this.assertBounds();
		return result;
	}
	b = this.buf[this.pos++];
	result |= (b & 127) << 7;
	if ((b & 128) == 0) {
		this.assertBounds();
		return result;
	}
	b = this.buf[this.pos++];
	result |= (b & 127) << 14;
	if ((b & 128) == 0) {
		this.assertBounds();
		return result;
	}
	b = this.buf[this.pos++];
	result |= (b & 127) << 21;
	if ((b & 128) == 0) {
		this.assertBounds();
		return result;
	}
	b = this.buf[this.pos++];
	result |= (b & 15) << 28;
	for (let readBytes = 5; (b & 128) !== 0 && readBytes < 10; readBytes++) b = this.buf[this.pos++];
	if ((b & 128) != 0) throw new Error("invalid varint");
	this.assertBounds();
	return result >>> 0;
}
var TWO_PWR_32_DBL;
var init_goog_varint = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/goog-varint.js"() {
	TWO_PWR_32_DBL = 4294967296;
} });

//#endregion
//#region node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/message-type.js
var baseDescriptors, messageTypeDescriptor, MessageType;
var init_message_type = __esm({ "node_modules/.pnpm/@protobuf-ts+runtime@2.11.1/node_modules/@protobuf-ts/runtime/build/es2015/message-type.js"() {
	init_message_type_contract();
	init_reflection_info();
	init_reflection_type_check();
	init_reflection_json_reader();
	init_reflection_json_writer();
	init_reflection_binary_reader();
	init_reflection_binary_writer();
	init_reflection_create();
	init_reflection_merge_partial();
	init_json_typings();
	init_json_format_contract();
	init_reflection_equals();
	init_binary_writer();
	init_binary_reader();
	baseDescriptors = Object.getOwnPropertyDescriptors(Object.getPrototypeOf({}));
	messageTypeDescriptor = baseDescriptors[MESSAGE_TYPE] = {};
	MessageType = class {
		constructor(name, fields, options) {
			this.defaultCheckDepth = 16;
			this.typeName = name;
			this.fields = fields.map(normalizeFieldInfo);
			this.options = options !== null && options !== void 0 ? options : {};
			messageTypeDescriptor.value = this;
			this.messagePrototype = Object.create(null, baseDescriptors);
			this.refTypeCheck = new ReflectionTypeCheck(this);
			this.refJsonReader = new ReflectionJsonReader(this);
			this.refJsonWriter = new ReflectionJsonWriter(this);
			this.refBinReader = new ReflectionBinaryReader(this);
			this.refBinWriter = new ReflectionBinaryWriter(this);
		}
		create(value) {
			let message = reflectionCreate(this);
			if (value !== undefined) reflectionMergePartial(this, message, value);
			return message;
		}
		/**
		* Clone the message.
		*
		* Unknown fields are discarded.
		*/
		clone(message) {
			let copy = this.create();
			reflectionMergePartial(this, copy, message);
			return copy;
		}
		/**
		* Determines whether two message of the same type have the same field values.
		* Checks for deep equality, traversing repeated fields, oneof groups, maps
		* and messages recursively.
		* Will also return true if both messages are `undefined`.
		*/
		equals(a, b) {
			return reflectionEquals(this, a, b);
		}
		/**
		* Is the given value assignable to our message type
		* and contains no [excess properties](https://www.typescriptlang.org/docs/handbook/interfaces.html#excess-property-checks)?
		*/
		is(arg, depth = this.defaultCheckDepth) {
			return this.refTypeCheck.is(arg, depth, false);
		}
		/**
		* Is the given value assignable to our message type,
		* regardless of [excess properties](https://www.typescriptlang.org/docs/handbook/interfaces.html#excess-property-checks)?
		*/
		isAssignable(arg, depth = this.defaultCheckDepth) {
			return this.refTypeCheck.is(arg, depth, true);
		}
		/**
		* Copy partial data into the target message.
		*/
		mergePartial(target, source) {
			reflectionMergePartial(this, target, source);
		}
		/**
		* Create a new message from binary format.
		*/
		fromBinary(data, options) {
			let opt = binaryReadOptions(options);
			return this.internalBinaryRead(opt.readerFactory(data), data.byteLength, opt);
		}
		/**
		* Read a new message from a JSON value.
		*/
		fromJson(json, options) {
			return this.internalJsonRead(json, jsonReadOptions(options));
		}
		/**
		* Read a new message from a JSON string.
		* This is equivalent to `T.fromJson(JSON.parse(json))`.
		*/
		fromJsonString(json, options) {
			let value = JSON.parse(json);
			return this.fromJson(value, options);
		}
		/**
		* Write the message to canonical JSON value.
		*/
		toJson(message, options) {
			return this.internalJsonWrite(message, jsonWriteOptions(options));
		}
		/**
		* Convert the message to canonical JSON string.
		* This is equivalent to `JSON.stringify(T.toJson(t))`
		*/
		toJsonString(message, options) {
			var _a;
			let value = this.toJson(message, options);
			return JSON.stringify(value, null, (_a = options === null || options === void 0 ? void 0 : options.prettySpaces) !== null && _a !== void 0 ? _a : 0);
		}
		/**
		* Write the message to binary format.
		*/
		toBinary(message, options) {
			let opt = binaryWriteOptions(options);
			return this.internalBinaryWrite(message, opt.writerFactory(), opt).finish();
		}
		/**
		* This is an internal method. If you just want to read a message from
		* JSON, use `fromJson()` or `fromJsonString()`.
		*
		* Reads JSON value and merges the fields into the target
		* according to protobuf rules. If the target is omitted,
		* a new instance is created first.
		*/
		internalJsonRead(json, options, target) {
			if (json !== null && typeof json == "object" && !Array.isArray(json)) {
				let message = target !== null && target !== void 0 ? target : this.create();
				this.refJsonReader.read(json, message, options);
				return message;
			}
			throw new Error(`Unable to parse message ${this.typeName} from JSON ${typeofJsonValue(json)}.`);
		}
		/**
		* This is an internal method. If you just want to write a message
		* to JSON, use `toJson()` or `toJsonString().
		*
		* Writes JSON value and returns it.
		*/
		internalJsonWrite(message, options) {
			return this.refJsonWriter.write(message, options);
		}
		/**
		* This is an internal method. If you just want to write a message
		* in binary format, use `toBinary()`.
		*
		* Serializes the message in binary format and appends it to the given
		* writer. Returns passed writer.
		*/
		internalBinaryWrite(message, writer, options) {
			this.refBinWriter.write(message, writer, options);
			return writer;
		}
		/**
		* This is an internal method. If you just want to read a message from
		* binary data, use `fromBinary()`.
		*
		* Reads data from binary format and merges the fields into
		* the target according to protobuf rules. If the target is
		* omitted, a new instance is created first.
		*/
		internalBinaryRead(reader, length, options, target) {
			let message = target !== null && target !== void 0 ? target : this.create();
			this.refBinReader.read(reader, message, options, length);
			return message;
		}
	};
} });

//#endregion
exports.onLoad = onLoad
exports.onUnload = onUnload
return exports;
})({});