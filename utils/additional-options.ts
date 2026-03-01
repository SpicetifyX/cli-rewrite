import fs from "node:fs/promises";
import path from "node:path";
import { 
  htmlMod, 
  insertCustomApp, 
  insertExpFeatures, 
  insertHomeConfig, 
  insertVersionInfo,
  insertSidebarConfig
} from "./mods";
import { PatchManager } from "./patch-utils";
import { parse } from "ini";

const BaseColorList: Record<string, string> = {
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

const BaseColorOrder = [
  "text",
  "subtext",
  "main",
  "main-elevated",
  "highlight",
  "highlight-elevated",
  "sidebar",
  "player",
  "card",
  "shadow",
  "selected-row",
  "button",
  "button-active",
  "button-disabled",
  "tab-active",
  "notification",
  "notification-error",
  "misc",
];

function stringToInt(raw: string, base: number): number {
  let val = parseInt(raw, base);
  if (isNaN(val)) val = 255;
  return Math.max(0, Math.min(255, val));
}

function parseColor(raw: string): { hex: string, rgb: string } {
  let r = 255, g = 255, b = 255;

  if (raw.startsWith("${")) {
    const envVar = raw.slice(2, -1);
    raw = process.env[envVar] || "ffffff";
  }

  if (raw.includes(",")) {
    const parts = raw.split(",").map(p => p.trim());
    r = stringToInt(parts[0], 10);
    g = stringToInt(parts[1], 10);
    b = stringToInt(parts[2], 10);
  } else {
    let hex = raw.replace(/[^a-fA-F0-9]/g, "");
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    hex = (hex + "ffffff").slice(0, 6);
    r = stringToInt(hex.slice(0, 2), 16);
    g = stringToInt(hex.slice(2, 4), 16);
    b = stringToInt(hex.slice(4, 6), 16);
  }

  const hexOut = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return {
    hex: hexOut,
    rgb: `${r},${g},${b}`
  };
}

function getColorCSS(scheme: Record<string, any>): string {
  let variableList = "";
  let variableRGBList = "";
  const mergedScheme = { ...BaseColorList };
  
  for (const [k, v] of Object.entries(scheme)) {
    if (v) mergedScheme[k] = v as string;
  }

  for (const [k, v] of Object.entries(mergedScheme)) {
    const parsed = parseColor(v);
    variableList += `    --spice-${k}: #${parsed.hex};\n`;
    variableRGBList += `    --spice-rgb-${k}: ${parsed.rgb};\n`;
  }

  return `:root {\n${variableList}${variableRGBList}}\n`;
}

export async function registerAdditionalPatches(patchManager: PatchManager, appsFolderPath: string, config: any) {
  const xpuiPath = path.join(appsFolderPath, "xpui");
  const spicetifyDir = path.join(process.env.APPDATA!, "Spicetify");

  const customApps = config.AdditionalOptions.custom_apps ? config.AdditionalOptions.custom_apps.split("|") : [];
  const manifests: any[] = [];
  for (const app of customApps) {
    if (!app) continue;
    try {
      const manifestPath = path.join(spicetifyDir, "CustomApps", app, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifests.push({ 
        subfiles: manifest.subfiles || [],
        subfiles_extension: manifest.subfiles_extension || manifest.extension_files || [],
        name: app 
      });
    } catch {}
  }

  patchManager.addPatch(path.join(xpuiPath, "index.html"), (c) => htmlMod(c, config, manifests));
  
  const mainJsModifiers = (c: string) => {
    c = insertExpFeatures(c);
    c = insertHomeConfig(c);
    c = insertSidebarConfig(c);
    c = insertCustomApp(c, config);
    return c;
  };

  patchManager.addPatch(path.join(xpuiPath, "xpui.js"), mainJsModifiers);
  patchManager.addPatch(path.join(xpuiPath, "xpui-modules.js"), (c) => {
    c = insertExpFeatures(c);
    c = insertHomeConfig(c);
    c = insertSidebarConfig(c);
    return c;
  });

  patchManager.addPatch(path.join(xpuiPath, "xpui-snapshot.js"), (c) => insertCustomApp(c, config));
  patchManager.addPatch(path.join(xpuiPath, "home-v2.js"), (c) => insertHomeConfig(c));
  patchManager.addPatch(path.join(xpuiPath, "xpui-desktop-modals.js"), (c) => insertVersionInfo(c));

  const helperPath = path.join(xpuiPath, "helper");
  await fs.mkdir(helperPath, { recursive: true });
  const localJsPatches = path.join(process.cwd(), "jsPatches");
  for (const patch of ["homeConfig.js", "spicetifyWrapper.js", "expFeatures.js", "sidebarConfig.js"]) {
    try { await fs.copyFile(path.join(localJsPatches, patch), path.join(helperPath, patch)); } catch {}
  }

  const themeName = config.Setting.current_theme;
  if (themeName) {
    const themeDir = path.join(spicetifyDir, "Themes", themeName);
    try {
      const colorIniPath = path.join(themeDir, "color.ini");
      const schemeName = config.Setting.color_scheme || "Base";
      
      let colorIni: any = {};
      try {
        colorIni = parse(await fs.readFile(colorIniPath, "utf8"));
      } catch {}

      const selectedScheme = colorIni[schemeName] || colorIni["Base"] || Object.values(colorIni)[0] || {};
      const colorsCss = getColorCSS(selectedScheme);
      await fs.writeFile(path.join(xpuiPath, "colors.css"), colorsCss);

      try {
        const userCss = await fs.readFile(path.join(themeDir, "user.css"), "utf8");
        await fs.writeFile(path.join(xpuiPath, "user.css"), userCss);
      } catch {
        await fs.writeFile(path.join(xpuiPath, "user.css"), "");
      }

      const assetsDir = path.join(themeDir, "assets");
      try { await fs.cp(assetsDir, xpuiPath, { recursive: true }); } catch {}

      try {
        const themeJsPath = path.join(themeDir, "theme.js");
        const extDest = path.join(xpuiPath, "extensions");
        await fs.mkdir(extDest, { recursive: true });
        await fs.copyFile(themeJsPath, path.join(extDest, "theme.js"));
      } catch {
        await fs.writeFile(path.join(xpuiPath, "extensions", "theme.js"), "");
      }
    } catch (e) {
      console.error(`Error applying theme ${themeName}:`, e);
    }
  }

  const extensions = config.AdditionalOptions.extensions ? config.AdditionalOptions.extensions.split("|") : [];
  const extDest = path.join(xpuiPath, "extensions");
  await fs.mkdir(extDest, { recursive: true });
  for (const ext of extensions) {
    if (!ext) continue;
    try {
      const extName = ext.endsWith(".js") || ext.endsWith(".mjs") ? ext : `${ext}.js`;
      const extSrc = path.join(spicetifyDir, "Extensions", extName);
      await fs.copyFile(extSrc, path.join(extDest, extName));
    } catch (e) {
      console.warn(`Extension not found: ${ext}`);
    }
  }

  for (const app of customApps) {
    if (!app) continue;
    try {
      const appSrc = path.join(spicetifyDir, "CustomApps", app);
      const appDest = path.join(extDest, app);
      await fs.cp(appSrc, appDest, { recursive: true });
    } catch (e) {
      console.warn(`Custom app not found: ${app}`);
    }
  }
}
