import fs from "node:fs/promises";
import path from "node:path";
import { 
  htmlMod, 
  insertCustomApp, 
  insertExpFeatures, 
  insertHomeConfig, 
  insertVersionInfo 
} from "./mods";
import { PatchManager } from "./patch-utils";
import { parse } from "ini";

const baseColorList: Record<string, string> = {
  "text":               "ffffff",
  "subtext":            "b3b3b3",
  "main":               "121212",
  "main-elevated":      "242424",
  "highlight":          "1a1a1a",
  "highlight-elevated": "2a2a2a",
  "sidebar":            "000000",
  "player":             "181818",
  "card":               "282828",
  "shadow":             "000000",
  "selected-row":       "ffffff",
  "button":             "1db954",
  "button-active":      "1ed760",
  "button-disabled":    "535353",
  "tab-active":         "333333",
  "notification":       "4687d6",
  "notification-error": "e22134",
  "misc":               "7f7f7f",
};

function parseColor(raw: string): { hex: string, rgb: string } {
  let hex = raw.replace("#", "");
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) hex = "ffffff";
  
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  
  return {
    hex: hex.toLowerCase(),
    rgb: `${r},${g},${b}`
  };
}

export async function registerAdditionalPatches(patchManager: PatchManager, appsFolderPath: string, config: any) {
  const xpuiPath = path.join(appsFolderPath, "xpui");
  const spicetifyDir = path.join(process.env.APPDATA!, "Spicetify");

  // 1. Register file modifiers
  patchManager.addPatch(path.join(xpuiPath, "index.html"), (c) => htmlMod(c, config));
  
  const mainJsModifiers = (c: string) => {
    c = insertExpFeatures(c);
    c = insertHomeConfig(c);
    c = insertCustomApp(c, config);
    return c;
  };

  patchManager.addPatch(path.join(xpuiPath, "xpui.js"), mainJsModifiers);
  patchManager.addPatch(path.join(xpuiPath, "xpui-modules.js"), (c) => {
    c = insertExpFeatures(c);
    c = insertHomeConfig(c);
    return c;
  });

  patchManager.addPatch(path.join(xpuiPath, "xpui-snapshot.js"), (c) => insertCustomApp(c, config));
  patchManager.addPatch(path.join(xpuiPath, "home-v2.js"), (c) => insertHomeConfig(c));
  patchManager.addPatch(path.join(xpuiPath, "xpui-desktop-modals.js"), (c) => insertVersionInfo(c));

  // 2. Handle Helper Patches
  const helperPath = path.join(xpuiPath, "helper");
  await fs.mkdir(helperPath, { recursive: true });
  const localJsPatches = path.join(process.cwd(), "jsPatches");
  for (const patch of ["homeConfig.js", "spicetifyWrapper.js", "expFeatures.js"]) {
    try { await fs.copyFile(path.join(localJsPatches, patch), path.join(helperPath, patch)); } catch {}
  }

  // 3. Handle Themes
  const themeName = config.Setting.current_theme;
  if (themeName) {
    const themeDir = path.join(spicetifyDir, "Themes", themeName);
    try {
      // colors.css
      const themeIniPath = path.join(themeDir, "theme.ini");
      const schemeName = config.Setting.color_scheme || "Base";
      let schemeColors = { ...baseColorList };
      try {
        const themeIni = parse(await fs.readFile(themeIniPath, "utf8"));
        if (themeIni[schemeName]) {
          Object.assign(schemeColors, themeIni[schemeName]);
        }
      } catch {}

      let colorsCss = ":root {\n";
      for (const [k, v] of Object.entries(schemeColors)) {
        const parsed = parseColor(v as string);
        colorsCss += `    --spice-${k}: #${parsed.hex};\n`;
        colorsCss += `    --spice-rgb-${k}: ${parsed.rgb};\n`;
      }
      colorsCss += "}\n";
      await fs.writeFile(path.join(xpuiPath, "colors.css"), colorsCss);

      // user.css
      try {
        const userCss = await fs.readFile(path.join(themeDir, "user.css"), "utf8");
        await fs.writeFile(path.join(xpuiPath, "user.css"), userCss);
      } catch {
        await fs.writeFile(path.join(xpuiPath, "user.css"), "");
      }

      // assets
      const assetsDir = path.join(themeDir, "assets");
      try {
        await fs.cp(assetsDir, xpuiPath, { recursive: true });
      } catch {}

      // theme.js
      try {
        const themeJsPath = path.join(themeDir, "theme.js");
        await fs.mkdir(path.join(xpuiPath, "extensions"), { recursive: true });
        await fs.copyFile(themeJsPath, path.join(xpuiPath, "extensions", "theme.js"));
      } catch {
        await fs.writeFile(path.join(xpuiPath, "extensions", "theme.js"), "");
      }
    } catch (e) {
      console.error(`Error applying theme ${themeName}:`, e);
    }
  }

  // 4. Handle Extensions
  const extensions = config.AdditionalOptions.extensions ? config.AdditionalOptions.extensions.split("|") : [];
  const extDest = path.join(xpuiPath, "extensions");
  await fs.mkdir(extDest, { recursive: true });
  for (const ext of extensions) {
    if (!ext) continue;
    try {
      const extSrc = path.join(spicetifyDir, "Extensions", ext.endsWith(".js") ? ext : `${ext}.js`);
      await fs.copyFile(extSrc, path.join(extDest, path.basename(extSrc)));
    } catch (e) {
      console.warn(`Extension not found: ${ext}`);
    }
  }

  // 5. Handle Custom Apps
  const customApps = config.AdditionalOptions.custom_apps ? config.AdditionalOptions.custom_apps.split("|") : [];
  for (const app of customApps) {
    if (!app) continue;
    try {
      const appSrc = path.join(spicetifyDir, "CustomApps", app);
      const appDest = path.join(extDest, app); // According to lazy loading logic
      await fs.cp(appSrc, appDest, { recursive: true });
    } catch (e) {
      console.warn(`Custom app not found: ${app}`);
    }
  }
}
