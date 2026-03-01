import fs from "node:fs/promises";
import path from "node:path";
import {
  htmlMod,
  insertCustomApp,
  insertExpFeatures,
  insertHomeConfig,
  insertVersionInfo,
} from "./mods";
import { PatchManager } from "./patch-utils";

export async function registerAdditionalPatches(
  patchManager: PatchManager,
  appsFolderPath: string,
  config: any,
) {
  const xpuiPath = path.join(appsFolderPath, "xpui");

  patchManager.addPatch(path.join(xpuiPath, "index.html"), (c) =>
    htmlMod(c, config),
  );

  patchManager.addPatch(path.join(xpuiPath, "xpui.js"), (c) => {
    c = insertExpFeatures(c);
    c = insertHomeConfig(c);
    c = insertCustomApp(c, config);
    return c;
  });

  patchManager.addPatch(path.join(xpuiPath, "xpui-modules.js"), (c) => {
    c = insertExpFeatures(c);
    c = insertHomeConfig(c);
    return c;
  });

  patchManager.addPatch(path.join(xpuiPath, "xpui-snapshot.js"), (c) =>
    insertCustomApp(c, config),
  );
  patchManager.addPatch(path.join(xpuiPath, "home-v2.js"), (c) =>
    insertHomeConfig(c),
  );
  patchManager.addPatch(path.join(xpuiPath, "xpui-desktop-modals.js"), (c) =>
    insertVersionInfo(c),
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
