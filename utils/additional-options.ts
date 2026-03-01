import fs from "node:fs/promises";
import path from "node:path";
import {
  htmlMod,
  insertCustomApp,
  insertExpFeatures,
  insertHomeConfig,
  insertVersionInfo,
} from "./mods";

export async function additionalOptions(appsFolderPath: string, config: any) {
  const xpuiPath = path.join(appsFolderPath, "xpui");

  const filesToModify = [
    {
      path: path.join(xpuiPath, "index.html"),
      modifiers: [async (p: string) => await htmlMod(p, config)],
    },
    {
      path: path.join(xpuiPath, "xpui.js"),
      modifiers: [
        async (p: string) => await insertExpFeatures(p),
        async (p: string) => await insertHomeConfig(p),
        async (p: string) => await insertCustomApp(p, config),
      ],
    },
    {
      path: path.join(xpuiPath, "xpui-modules.js"),
      modifiers: [
        async (p: string) => await insertExpFeatures(p),
        async (p: string) => await insertHomeConfig(p),
      ],
    },
    {
      path: path.join(xpuiPath, "xpui-snapshot.js"),
      modifiers: [async (p: string) => await insertCustomApp(p, config)],
    },
    {
      path: path.join(xpuiPath, "home-v2.js"),
      modifiers: [async (p: string) => await insertHomeConfig(p)],
    },
    {
      path: path.join(xpuiPath, "xpui-desktop-modals.js"),
      modifiers: [async (p: string) => await insertVersionInfo(p)],
    },
  ];

  await Promise.all(
    filesToModify.map(async (item) => {
      try {
        await fs.access(item.path);
        for (const mod of item.modifiers) {
          await mod(item.path);
        }
      } catch (e) {
        console.log(e);
      }
    }),
  );

  const helperPath = path.join(xpuiPath, "helper");
  await fs.mkdir(helperPath, { recursive: true });

  const patches = ["homeConfig.js", "spicetifyWrapper.js", "expFeatures.js"];
  const jsPatchesDir = path.join(process.cwd(), "jsPatches");

  await Promise.all(
    patches.map(async (patch) => {
      try {
        await fs.copyFile(
          path.join(jsPatchesDir, patch),
          path.join(helperPath, patch),
        );
      } catch (e) {
        console.error(`Failed to copy ${patch}:`, e);
      }
    }),
  );
}
