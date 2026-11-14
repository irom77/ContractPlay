import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export function isNativeClient(): boolean {
  return isTauri();
}

export async function openHandFiles(): Promise<readonly Readonly<{ name: string; contents: string }>[] | null> {
  const selected = await open({
    title: "Import hand records or PBN with USEBIO results",
    multiple: true,
    directory: false,
    fileAccessMode: "scoped",
    filters: [{ name: "Bridge hand, results, or board set backup", extensions: ["pbn", "lin", "xml", "txt", "json"] }]
  });
  if (!selected) return null;
  const paths = Array.isArray(selected) ? selected : [selected];
  return Promise.all(paths.map(async (path) => ({
    name: path.split(/[\\/]/).at(-1) ?? path,
    contents: await readTextFile(path)
  })));
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
