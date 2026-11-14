import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export function isNativeClient(): boolean {
  return isTauri();
}

export async function openPbnFile(): Promise<string | null> {
  const path = await open({
    title: "Import a bridge hand",
    multiple: false,
    directory: false,
    fileAccessMode: "scoped",
    filters: [{ name: "Bridge hand or board set backup", extensions: ["pbn", "txt", "json"] }]
  });
  if (!path) return null;
  return readTextFile(path);
}

export async function savePbnFile(fileName: string, contents: string): Promise<boolean> {
  const path = await save({
    title: "Export bridge hand",
    defaultPath: fileName,
    filters: [{ name: fileName.endsWith(".json") ? "Board set backup" : "Portable Bridge Notation", extensions: [fileName.endsWith(".json") ? "json" : "pbn"] }]
  });
  if (!path) return false;
  await writeTextFile(path, contents);
  return true;
}
