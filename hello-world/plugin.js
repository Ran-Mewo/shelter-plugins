(function(exports) {

"use strict";

//#region plugins/hello-world/index.jsx
const { util: { log } } = shelter;
function onLoad() {
	log("Hello, World from shelter!");
}
function onUnload() {
	log("Goodbye, World from shelter!");
}

//#endregion
exports.onLoad = onLoad
exports.onUnload = onUnload
return exports;
})({});