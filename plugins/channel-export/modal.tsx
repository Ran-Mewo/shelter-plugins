import { exportStatus, startExport, stopExport } from "./exporter";
import { FORMATS } from "./formats";

const {
  solid: { For, Show },
  solidStore: { createStore },
  ui: { Button, ButtonColors, ModalBody, ModalFooter, ModalHeader, ModalRoot, SelectItem, SelectOption, SwitchItem, Text, openModal },
} = shelter;

const [options, setOptions] = createStore({ formatId: "json", ignoreHumans: false, ignoreApps: false });

function ExportModal(props: { channelId: string; close(): void }) {
  return (
    <ModalRoot>
      <ModalHeader close={props.close}>Export channel</ModalHeader>
      <Show
        when={exportStatus()}
        fallback={
          <>
            <ModalBody>
              <SelectItem label="Format" value={options.formatId} onChange={formatId => setOptions("formatId", formatId as string)}>
                <For each={Object.keys(FORMATS)}>{formatId => <SelectOption value={formatId}>{FORMATS[formatId].label}</SelectOption>}</For>
              </SelectItem>
              <SwitchItem checked={options.ignoreHumans} onChange={ignore => setOptions("ignoreHumans", ignore)}>Ignore humans</SwitchItem>
              <SwitchItem checked={options.ignoreApps} onChange={ignore => setOptions("ignoreApps", ignore)} hideBorder>Ignore apps</SwitchItem>
            </ModalBody>
            <ModalFooter>
              <Button grow disabled={options.ignoreHumans && options.ignoreApps} onClick={() => startExport(props.channelId, options)}>Export every message</Button>
            </ModalFooter>
          </>
        }
      >
        <ModalBody>
          <Text>Exporting {exportStatus()?.name}: {exportStatus()?.messageCount.toLocaleString()} messages saved ({Math.floor((exportStatus()?.progress ?? 0) * 100)}%). Closing this won't stop it.</Text>
        </ModalBody>
        <ModalFooter>
          <Button grow color={ButtonColors.CRITICAL_SECONDARY} disabled={exportStatus()?.stopping} onClick={stopExport}>Stop and save</Button>
        </ModalFooter>
      </Show>
    </ModalRoot>
  );
}

export const openExportModal = (channelId: string) => openModal(({ close }) => <ExportModal channelId={channelId} close={close} />);
