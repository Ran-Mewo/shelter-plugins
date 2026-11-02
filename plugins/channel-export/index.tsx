import { stopExport } from "./exporter";
import { openExportModal } from "./modal";

const {
  flux: { storesFlat: { SelectedChannelStore } },
  plugin: { scoped },
  ui: { tooltip },
} = shelter;

const HEADER_TOOLBAR = '[class*="upperContainer_"] [class*="toolbar_"]';
const BUTTON_CLASS = "channel-export-button";

function addHeaderButton(toolbar: Element) {
  const nativeButton = toolbar.querySelector('[class*="iconWrapper_"]:not([class*="selected_"])');
  if (!nativeButton || toolbar.querySelector(`.${BUTTON_CLASS}`)) return;
  const buttonClass = `${nativeButton.className} ${BUTTON_CLASS}`;
  const iconClass = nativeButton.querySelector("svg")?.getAttribute("class") ?? "";

  toolbar.prepend(
    <div class={buttonClass} role="button" aria-label="Export channel" use:tooltip={[true, "Export channel"]} on:click={() => openExportModal(SelectedChannelStore.getChannelId())}>
      <svg class={iconClass} width="24" height="24" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z" />
      </svg>
    </div> as Element
  );
}

export function onLoad() {
  scoped.observeDom(HEADER_TOOLBAR, addHeaderButton);
  document.querySelectorAll(HEADER_TOOLBAR).forEach(addHeaderButton);
}

export function onUnload() {
  stopExport();
  document.querySelectorAll(`.${BUTTON_CLASS}`).forEach(button => button.remove());
}
