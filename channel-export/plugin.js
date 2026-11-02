(function(exports) {

//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function() {
	return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
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

//#endregion

//#region solid-js/web
var require_web = __commonJS({ "solid-js/web"(exports, module) {
	module.exports = shelter.solidWeb;
} });

//#endregion
//#region plugins/channel-export/fetching.ts
const { http, util: { sleep } } = shelter;
const MAX_RETRIES = 5;
async function get(url, query) {
	await http.ready;
	for (let failures = 0;;) try {
		const { body, headers } = await http.get({
			url,
			query
		});
		if (headers["x-ratelimit-remaining"] === "0") await sleep(Number(headers["x-ratelimit-reset-after"]) * 1e3);
		return body;
	} catch (error) {
		const isRateLimit = error?.status === 429;
		if (!isRateLimit && (error?.status < 500 || ++failures > MAX_RETRIES)) throw error;
		await sleep((isRateLimit ? error.body?.retry_after ?? 1 : failures * 2) * 1e3);
	}
}
const getChannel = (channelId) => get(`/channels/${channelId}`);
async function* getMessagesOldestFirst(channelId) {
	for (let after = "0";;) {
		const page = await get(`/channels/${channelId}/messages`, {
			limit: 100,
			after
		});
		if (!page.length) return;
		page.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
		yield page;
		after = page[page.length - 1].id;
	}
}

//#endregion
//#region plugins/channel-export/formats.ts
const formatMessage = (message) => `[${new Date(message.timestamp).toLocaleString()}] ${message.author.username}: ${[message.content, ...message.attachments.map((attachment) => attachment.url)].filter(Boolean).join("\n")}\n`;
const prettyJson = (value, indent) => JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
const FORMATS = {
	json: {
		label: "JSON (complete data)",
		page: (messages, isFirstPage) => (isFirstPage ? "" : ",\n") + messages.map((message) => `    ${prettyJson(message, "    ")}`).join(",\n"),
		wrap: (channel, pages) => [
			`{\n  "channel": ${prettyJson(channel, "  ")},\n  "messages": [\n`,
			...pages,
			"\n  ]\n}\n"
		]
	},
	txt: {
		label: "Text (readable)",
		page: (messages) => messages.map(formatMessage).join(""),
		wrap: (_, pages) => pages
	}
};

//#endregion
//#region plugins/channel-export/exporter.ts
const { solid: { createSignal }, ui: { showToast } } = shelter;
const [exportStatus, setExportStatus] = createSignal(null);
const stopExport = () => setExportStatus((status) => status && {
	...status,
	stopping: true
});
function download(parts, filename) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob(parts));
	link.download = filename.replace(/[\\/:*?"<>|]/g, "_");
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 6e4);
}
async function startExport(channelId, { formatId, ignoreHumans, ignoreApps }) {
	if (exportStatus()) return;
	const format = FORMATS[formatId];
	const pages = [];
	let channel, error, oldestId, name = channelId, messageCount = 0;
	setExportStatus({
		name,
		messageCount,
		progress: 0
	});
	try {
		channel = await getChannel(channelId);
		name = channel.name || channel.recipients?.map((user) => user.username).join(", ") || channelId;
		for await (const page of getMessagesOldestFirst(channelId)) {
			oldestId ??= page[0].id;
			const kept = page.filter((message) => !(message.author.bot ? ignoreApps : ignoreHumans));
			if (kept.length) pages.push(new Blob([format.page(kept, !messageCount)]));
			messageCount += kept.length;
			const progress = (Number(page[page.length - 1].id) - Number(oldestId)) / (Number(channel.last_message_id) - Number(oldestId) || 1);
			setExportStatus((status) => status && {
				...status,
				name,
				messageCount,
				progress: Math.min(progress, 1)
			});
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
	showToast({
		title: `Channel export ${error ? "failed" : stopped ? "stopped" : "finished"}`,
		content: `${reason}Saved ${messageCount.toLocaleString()} messages from ${name}.`
	});
}

//#endregion
//#region plugins/channel-export/modal.tsx
var import_web$5 = __toESM(require_web(), 1);
var import_web$6 = __toESM(require_web(), 1);
const { solid: { For, Show }, solidStore: { createStore }, ui: { Button, ButtonColors, ModalBody, ModalFooter, ModalHeader, ModalRoot, SelectItem, SelectOption, SwitchItem, Text, openModal } } = shelter;
const [options, setOptions] = createStore({
	formatId: "json",
	ignoreHumans: false,
	ignoreApps: false
});
function ExportModal(props) {
	return (0, import_web$6.createComponent)(ModalRoot, { get children() {
		return [(0, import_web$6.createComponent)(ModalHeader, {
			get close() {
				return props.close;
			},
			children: "Export channel"
		}), (0, import_web$6.createComponent)(Show, {
			get when() {
				return exportStatus();
			},
			get fallback() {
				return [(0, import_web$6.createComponent)(ModalBody, { get children() {
					return [
						(0, import_web$6.createComponent)(SelectItem, {
							label: "Format",
							get value() {
								return options.formatId;
							},
							onChange: (formatId) => setOptions("formatId", formatId),
							get children() {
								return (0, import_web$6.createComponent)(For, {
									get each() {
										return Object.keys(FORMATS);
									},
									children: (formatId) => (0, import_web$6.createComponent)(SelectOption, {
										value: formatId,
										get children() {
											return FORMATS[formatId].label;
										}
									})
								});
							}
						}),
						(0, import_web$6.createComponent)(SwitchItem, {
							get checked() {
								return options.ignoreHumans;
							},
							onChange: (ignore) => setOptions("ignoreHumans", ignore),
							children: "Ignore humans"
						}),
						(0, import_web$6.createComponent)(SwitchItem, {
							get checked() {
								return options.ignoreApps;
							},
							onChange: (ignore) => setOptions("ignoreApps", ignore),
							hideBorder: true,
							children: "Ignore apps"
						})
					];
				} }), (0, import_web$6.createComponent)(ModalFooter, { get children() {
					return (0, import_web$6.createComponent)(Button, {
						grow: true,
						get disabled() {
							return options.ignoreHumans && options.ignoreApps;
						},
						onClick: () => startExport(props.channelId, options),
						children: "Export every message"
					});
				} })];
			},
			get children() {
				return [(0, import_web$6.createComponent)(ModalBody, { get children() {
					return (0, import_web$6.createComponent)(Text, { get children() {
						return [
							"Exporting ",
							(0, import_web$5.memo)(() => exportStatus()?.name),
							": ",
							(0, import_web$5.memo)(() => exportStatus()?.messageCount.toLocaleString()),
							" messages saved (",
							(0, import_web$5.memo)(() => Math.floor((exportStatus()?.progress ?? 0) * 100)),
							"%). Closing this won't stop it."
						];
					} });
				} }), (0, import_web$6.createComponent)(ModalFooter, { get children() {
					return (0, import_web$6.createComponent)(Button, {
						grow: true,
						get color() {
							return ButtonColors.CRITICAL_SECONDARY;
						},
						get disabled() {
							return exportStatus()?.stopping;
						},
						onClick: stopExport,
						children: "Stop and save"
					});
				} })];
			}
		})];
	} });
}
const openExportModal = (channelId) => openModal(({ close }) => (0, import_web$6.createComponent)(ExportModal, {
	channelId,
	close
}));

//#endregion
//#region plugins/channel-export/index.tsx
var import_web = __toESM(require_web(), 1);
var import_web$1 = __toESM(require_web(), 1);
var import_web$2 = __toESM(require_web(), 1);
var import_web$3 = __toESM(require_web(), 1);
var import_web$4 = __toESM(require_web(), 1);
const _tmpl$ = /*#__PURE__*/ (0, import_web.template)(`<div role="button" aria-label="Export channel"><svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z"></path></svg></div>`, 6);
const { flux: { storesFlat: { SelectedChannelStore } }, plugin: { scoped }, ui: { tooltip } } = shelter;
const HEADER_TOOLBAR = "[class*=\"upperContainer_\"] [class*=\"toolbar_\"]";
const BUTTON_CLASS = "channel-export-button";
function addHeaderButton(toolbar) {
	const nativeButton = toolbar.querySelector("[class*=\"iconWrapper_\"]:not([class*=\"selected_\"])");
	if (!nativeButton || toolbar.querySelector(`.${BUTTON_CLASS}`)) return;
	const buttonClass = `${nativeButton.className} ${BUTTON_CLASS}`;
	const iconClass = nativeButton.querySelector("svg")?.getAttribute("class") ?? "";
	toolbar.prepend((() => {
		const _el$ = (0, import_web$1.getNextElement)(_tmpl$), _el$2 = _el$.firstChild;
		(0, import_web$3.use)(tooltip, _el$, () => [true, "Export channel"]);
		(0, import_web$4.className)(_el$, buttonClass);
		_el$.addEventListener("click", () => openExportModal(SelectedChannelStore.getChannelId()));
		(0, import_web$2.setAttribute)(_el$2, "class", iconClass);
		return _el$;
	})());
}
function onLoad() {
	scoped.observeDom(HEADER_TOOLBAR, addHeaderButton);
	document.querySelectorAll(HEADER_TOOLBAR).forEach(addHeaderButton);
}
function onUnload() {
	stopExport();
	document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => button.remove());
}

//#endregion
exports.onLoad = onLoad
exports.onUnload = onUnload
return exports;
})({});