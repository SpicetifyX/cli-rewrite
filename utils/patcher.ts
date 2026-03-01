import { mkdir, readdir, rm, stat } from "fs/promises";

import decompress from "decompress";
import path from "path";
import { toggleDevtools } from "./devtools";
import fs from "node:fs/promises";
import { getMinimalModifiers } from "./minimal";
import { registerAdditionalPatches } from "./additional-options";
import { readConfig } from "./config";
import { PatchManager } from "./patch-utils";

export async function applyPatches() {
  console.log("Enabling devtools...");
  await toggleDevtools(true);

  console.log("Applying patches...");
  const backupDir = path.join(process.env.APPDATA!, "Spicetify", "Backup");
  let backupEntries = await readdir(backupDir);
  if (
    !backupEntries.includes("login.spa") ||
    !backupEntries.includes("xpui.spa")
  ) {
    console.log(
      'No backup is available run "backup apply" to backup and apply patches',
    );
    process.exit(0);
  }

  const spotifyAppsDir = path.join(process.env.APPDATA!, "Spotify", "Apps");
  const destXpui = path.join(spotifyAppsDir, "xpui");

  try {
    const s = await stat(destXpui);
    if (s.isDirectory()) {
      console.log(
        "Spotify already patched (xpui directory exists). Re-patching...",
      );
    }
  } catch (e) {
    console.log(e);
  }

  const extractedDir = path.join(
    process.env.APPDATA!,
    "Spicetify",
    "Extracted",
  );
  await rm(extractedDir, { recursive: true, force: true });
  await mkdir(path.join(extractedDir, "Themed", "xpui"), { recursive: true });

  console.log("Decompressing xpui.spa...");
  await decompress(
    path.join(spotifyAppsDir, "xpui.spa"),
    path.join(extractedDir, "Themed", "xpui"),
  );
  console.log("Decompression finished.");

  const v8SnapshotPath = path.join(
    process.env.APPDATA!,
    "Spotify",
    "v8_context_snapshot.bin",
  );
  console.log("Extracting xpui-modules.js from v8 snapshot...");
  try {
    const file = await fs.readFile(v8SnapshotPath);
    const startMarker = Buffer.from("var __webpack_modules__={", "utf16le");
    const endMarker = Buffer.from("xpui-modules.js.map", "utf16le");
    const offset = file[0] === 0xff && file[1] === 0xfe ? 2 : 0;
    const startIndex = file.indexOf(startMarker, offset);
    if (startIndex !== -1) {
      const endIndex = file.indexOf(endMarker, startIndex + startMarker.length);
      if (endIndex !== -1) {
        const finalEndIndex = endIndex + endMarker.length;
        const embeddedString = file
          .slice(startIndex, finalEndIndex)
          .toString("utf16le");
        await fs.writeFile(
          path.join(extractedDir, "Themed", "xpui", "xpui-modules.js"),
          embeddedString,
          { mode: 0o700 },
        );
        console.log("xpui-modules.js extracted successfully.");
      }
    }
  } catch (e) {
    console.error("Failed to read v8 snapshot:", e);
  }

  const config = await readConfig(
    path.join(process.env.APPDATA!, "Spicetify", "config-xpui.ini"),
  );
  const pm = new PatchManager();
  const appsFolderPath = path.join(extractedDir, "Themed");
  const xpuiPath = path.join(appsFolderPath, "xpui");

  let cssRegex: RegExp | null = null;
  let cssTranslationMap: Record<string, string> = {};
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/spicetify/cli/latest/css-map.json",
    );
    if (response.ok) {
      cssTranslationMap = (await response.json()) as Record<string, string>;
      const keys = Object.keys(cssTranslationMap);
      if (keys.length > 0) {
        console.log(`Loaded ${keys.length} CSS translations.`);
        cssRegex = new RegExp(
          keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
          "g",
        );
      }
    }
  } catch (e) {
    console.error("CSS map fetch failed:", e);
  }

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const p = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(p) : [p];
      }),
    );
    return files.flat();
  }

  console.log("Scanning files for patching...");
  const allFiles = await walk(xpuiPath);
  const targetFiles = allFiles.filter((f) =>
    [".js", ".css", ".html"].includes(path.extname(f)),
  );

  const minMods = getMinimalModifiers();
  for (const f of targetFiles) {
    const ext = path.extname(f);
    const fileName = path.basename(f);
    pm.addPatch(f, (content) => {
      if (ext === ".js") return minMods.js(content, fileName);
      if (ext === ".css") return minMods.css(content, fileName);
      if (ext === ".html") return minMods.html(content);
      return content;
    });
  }

  console.log("Registering additional patches...");
  await registerAdditionalPatches(pm, appsFolderPath, config);

  console.log(`Patching ${targetFiles.length} files in parallel...`);
  await pm.run(targetFiles, (content) => {
    if (cssRegex)
      return content.replace(cssRegex, (m) => cssTranslationMap[m]!);
    return content;
  });

  console.log("Cleaning up Spotify Apps directory and moving patched files...");
  const appsEntries = await readdir(spotifyAppsDir, { withFileTypes: true });
  for (const entry of appsEntries) {
    const name = entry.name.toLowerCase();
    if (
      name === "xpui.spa" ||
      name === "login.spa" ||
      name === "xpui" ||
      name === "login"
    )
      continue;
    if (name.endsWith(".spa")) continue;
    await rm(path.join(spotifyAppsDir, entry.name), {
      recursive: true,
      force: true,
    });
  }

  await rm(path.join(spotifyAppsDir, "xpui.spa"), { force: true });
  await rm(destXpui, { recursive: true, force: true });
  await fs.cp(xpuiPath, destXpui, { recursive: true });

  console.log("Spotify patched successfully!");
}
