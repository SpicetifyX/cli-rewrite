import { exists, mkdir, readdir, rm, stat } from "fs/promises";
import decompress from "decompress";
import path from "path";
import { toggleDevtools } from "./devtools";
import fs from "node:fs/promises";
import { startMinimal } from "./minimal";
import { additionalOptions } from "./additional-options";
import { readConfig } from "./config";

export async function applyPatches() {
  console.log("Enabling devtools");

  await toggleDevtools(true);

  console.log("Applying patches");

  let entries = await readdir(
    path.join(process.env.APPDATA!, "Spicetify", "Backup"),
  );
  if (!entries.includes("login.spa") || !entries.includes("xpui.spa")) {
    console.log(
      'No backup is available run "backup apply" to backup and apply patches',
    );
    process.exit(0);
  }

  entries = await readdir(path.join(process.env.APPDATA!, "Spotify", "Apps"));

  const isPatched = await Promise.all(
    entries.map(async (entry) => {
      if (
        (
          await stat(path.join(process.env.APPDATA!, "Spotify", "Apps", entry))
        ).isDirectory()
      ) {
        return true;
      } else {
        return false;
      }
    }),
  );

  if (isPatched.some((val) => val === true)) {
    console.log("Spotify already patched");
    process.exit(0);
  }

  if (await exists(path.join(process.env.APPDATA!, "Spicetify", "Extracted"))) {
    try {
      await rm(path.join(process.env.APPDATA!, "Spicetify", "Extracted"), {
        recursive: true,
        force: true,
      });

      await mkdir(path.join(process.env.APPDATA!, "Spicetify", "Extracted"), {
        recursive: true,
      });
      await mkdir(
        path.join(process.env.APPDATA!, "Spicetify", "Extracted", "Raw"),
        { recursive: true },
      );
      await mkdir(
        path.join(process.env.APPDATA!, "Spicetify", "Extracted", "Themed"),
        { recursive: true },
      );
      await mkdir(
        path.join(
          process.env.APPDATA!,
          "Spicetify",
          "Extracted",
          "Themed",
          "xpui",
        ),
        { recursive: true },
      );
    } catch (e) {
      console.log("Error recreating Extracted directory:", e);
    }
  }

  console.log("Decompressing xpui.spa...");
  await decompress(
    path.join(process.env.APPDATA!, "Spotify", "Apps", "xpui.spa"),
    path.join(process.env.APPDATA!, "Spicetify", "Extracted", "Themed", "xpui"),
  );

  const v8SnapshotPath = path.join(
    process.env.APPDATA!,
    "Spotify",
    "v8_context_snapshot.bin",
  );

  console.log("Reading v8 context snapshot...");
  const file = await fs.readFile(v8SnapshotPath);

  const startMarker = Buffer.from("var __webpack_modules__={", "utf16le");
  const endMarker = Buffer.from("xpui-modules.js.map", "utf16le");

  const startIndex = file.indexOf(startMarker);
  if (startIndex === -1) {
    throw new Error("Start marker not found");
  }

  const endIndex = file.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    throw new Error("End marker not found");
  }

  const embeddedString = file.slice(startIndex, endIndex).toString("utf16le");

  console.log("Saving xpui-modules.js...");
  await fs.writeFile(
    path.join(
      process.env.APPDATA!,
      "Spicetify",
      "Extracted",
      "Themed",
      "xpui",
      "xpui-modules.js",
    ),
    embeddedString,
    { mode: 0o700 },
  );

  const config = await readConfig(
    path.join(process.env.APPDATA!, "Spicetify", "config-xpui.ini"),
  );

  console.log("Starting minimal patching...");
  await startMinimal(
    path.join(process.env.APPDATA!, "Spicetify", "Extracted", "Themed"),
  );

  console.log("Applying additional options...");
  await additionalOptions(
    path.join(process.env.APPDATA!, "Spicetify", "Extracted", "Themed"),
    config,
  );

  console.log("Moving patched files to Spotify Apps...");
  try {
    await stat(path.join(process.env.APPDATA!, "Spotify", "Apps", "xpui.spa"));
    await rm(path.join(process.env.APPDATA!, "Spotify", "Apps", "xpui.spa"));
  } catch (e) {
    console.log(e);
  }

  await mkdir(path.join(process.env.APPDATA!, "Spotify", "Apps", "xpui"), {
    recursive: true,
  });

  await fs.cp(
    path.join(process.env.APPDATA!, "Spicetify", "Extracted", "Themed", "xpui"),
    path.join(process.env.APPDATA!, "Spotify", "Apps", "xpui"),
    {
      recursive: true,
    },
  );

  console.log("Spotify patched successfully!");
}
