import { replace, replaceOnce, seekToCloseParen } from "./patch-utils";
import fs from "node:fs/promises";
import path from "node:path";

export function htmlMod(content: string, config: any, customAppManifests: any[]): string {
  const extensions = config.AdditionalOptions.extensions ? config.AdditionalOptions.extensions.split("|") : [];
  const customApps = config.AdditionalOptions.custom_apps ? config.AdditionalOptions.custom_apps.split("|") : [];

  let extensionsHTML = "\n";
  let helperHTML = "\n";

  extensionsHTML += `<script defer src="/extensions/theme.js"></script>\n`;
  helperHTML += `<script defer src="/helper/sidebarConfig.js"></script>\n`;
  helperHTML += `<script defer src="/helper/homeConfig.js"></script>\n`;
  helperHTML += `<script defer src="/helper/expFeatures.js"></script>\n`;

  const extList = extensions.map((ext: string) => `"${ext}"`).join(",");
  const customAppList = customApps.map((app: string) => `"${app}"`).join(",");

  helperHTML += `<script>
    Spicetify.Config={};
    Spicetify.Config["version"]="${config.Backup.version || "0"}";
    Spicetify.Config["current_theme"]="${config.Setting.current_theme || ""}";
    Spicetify.Config["color_scheme"]="${config.Setting.color_scheme || ""}";
    Spicetify.Config["extensions"] = [${extList}];
    Spicetify.Config["custom_apps"] = [${customAppList}];
    Spicetify.Config["check_spicetify_update"]=${config.Setting.check_spicetify_update === "1"};
  </script>\n`;

  for (const v of extensions) {
    if (!v) continue;
    const src = v.endsWith(".mjs") || v.endsWith(".js") ? v : `${v}.js`;
    if (src.endsWith(".mjs")) {
      extensionsHTML += `<script defer type="module" src="/extensions/${src}"></script>\n`;
    } else {
      extensionsHTML += `<script defer src="/extensions/${src}"></script>\n`;
    }
  }

  for (const manifest of customAppManifests) {
    if (manifest.subfiles_extension) {
      for (const file of manifest.subfiles_extension) {
        if (file.endsWith(".mjs")) {
          extensionsHTML += `<script defer type="module" src="/extensions/${manifest.name}/${file}"></script>\n`;
        } else {
          extensionsHTML += `<script defer src="/extensions/${manifest.name}/${file}"></script>\n`;
        }
      }
    }
  }

  // Official Spicetify injection logic for xpui-modules.js
  content = replace(
    content,
    /<script defer="defer" src="\/xpui-snapshot\.js"><\/script>/,
    () => `<script defer="defer" src="/xpui-modules.js"></script><script defer="defer" src="/xpui-snapshot.js"></script>`
  );

  content = replace(
    content,
    /<!-- spicetify helpers -->/,
    (match) => `${match}${helperHTML}`
  );
  
  content = replace(
    content,
    /<\/body>/,
    (match) => `${extensionsHTML}${match}`
  );
  
  return content;
}

export function insertCustomApp(content: string, config: any): string {
  const customApps = config.AdditionalOptions.custom_apps ? config.AdditionalOptions.custom_apps.split("|") : [];
  if (customApps.length === 0) return content;

  const reactPatterns = [
    /([\w_\$][\w_\$\d]*(?:\(\))?)\.lazy\(\((?:\(\)=>|function\(\)\{return )(\w+)\.(\w+)\(\d+\)\.then\(\w+\.bind\(\w+,\d+\)\)\}?\)\)/,
    /([\w_\$][\w_\$\d]*)\.lazy\(async\(\)=>\{(?:[^{}]|\{[^{}]*\})*await\s+(\w+)\.(\w+)\(\d+\)\.then\(\w+\.bind\(\w+,\d+\)\)/,
    /([\w_\$][\w_\$\d]*(?:\(\))?)\.lazy\(async\(\)=>await\s+Promise\.all\(\[[^\]]+\]\)\.then\((\w+)\.bind\((\w+),\d+\)\)/,
  ];

  const elementPatterns = [
    /(\([\w$\.,]+\))\(([\w\.]+),\{path:"\/settings(?:\/[\w\*]+)?",?(element|children)?/,
    /([\w_\$][\w_\$\d]*(?:\(\))?\.createElement|\([\w$\.,]+\))\(([\w\.]+),\{path:"\/collection"(?:,(element|children)?[:.\w,{}()$/*"]+)?\}/,
  ];

  let reactSymbs: string[] | null = null;
  let matchedReactPattern: RegExp | null = null;
  for (const p of reactPatterns) {
    const match = content.match(p);
    if (match) {
      reactSymbs = match.slice(1);
      matchedReactPattern = p;
      break;
    }
  }

  let eleSymbs: string[] | null = null;
  let matchedElementPattern: RegExp | null = null;
  for (const p of elementPatterns) {
    const match = content.match(p);
    if (match) {
      eleSymbs = match.slice(1);
      matchedElementPattern = p;
      break;
    }
  }

  if (!reactSymbs || reactSymbs.length < 2 || !eleSymbs || eleSymbs.length === 0) {
    return content;
  }

  let appMap = "";
  let appReactMap = "";
  let appEleMap = "";
  let cssEnableMap = "";
  const appNames = customApps.map(app => `"${app}"`).join(",");

  let wildcard = "";
  if (!eleSymbs[2]) {
    eleSymbs[2] = "children";
  } else if (eleSymbs[2] === "element") {
    wildcard = "*";
  }

  customApps.forEach((app, index) => {
    const appName = `spicetify-routes-${app}`;
    appMap += `"${appName}":"${appName}",`;
    appReactMap += `,spicetifyApp${index}=${reactSymbs![0]}.lazy((()=>${reactSymbs![1]}.${reactSymbs![2]}("${appName}").then(${reactSymbs![1]}.bind(${reactSymbs![1]},"${appName}"))))`;
    appEleMap += `${eleSymbs![0]}(${eleSymbs![1]},{path:"/${app}/${wildcard}",pathV6:"/${app}/*",${eleSymbs![2]}:${eleSymbs![0]}(spicetifyApp${index},{})}),`;
    cssEnableMap += `,"${appName}":1`;
  });

  content = replace(content, /\{(\d+:"xpui)/, (match, p1) => `{${appMap}${p1}`);

  const reactMatch = seekToCloseParen(content, matchedReactPattern!, "(", ")");
  if (reactMatch) {
    content = content.replace(reactMatch, `${reactMatch}${appReactMap}`);
  }

  content = replaceOnce(content, matchedElementPattern!, (match) => `${appEleMap}${match}`);
  content = insertNavLink(content, `[${appNames}]`);
  content = replaceOnce(content, /\d+:1,\d+:1,\d+:1/, (match) => `${match}${cssEnableMap}`);

  return content;
}

function insertNavLink(str: string, appNameArray: string): string {
  const libraryXItemMatch = seekToCloseParen(str, /\("li",\{[^\{]*\{[^\{]*\{to:"\/search/, "(", ")");
  if (libraryXItemMatch) {
    str = str.replace(libraryXItemMatch, `${libraryXItemMatch},Spicetify._renderNavLinks(${appNameArray}, false)`);
  }

  const patterns = [
    /(,[a-zA-Z_\$][\w\$]*===(?:[a-zA-Z_\$][\w\$]*\.){2}HOME_NEXT_TO_NAVIGATION&&.+?)\]/,
    /("global-nav-bar".*[[\w\$&|]*\(0,[a-zA-Z_\$][\w\$]*\.jsx\)\(\s*\w+,\s*\{\s*className:\w*\s*\}\s*\))\]/,
    /("global-nav-bar".*?)(\(0,\s*[a-zA-Z_\$][\w\$]*\.jsx\))(\(\s*\w+,\s*\{\s*className:\w*\s*\}\s*\))/,
  ];

  for (let i = 0; i < patterns.length; i++) {
    const re = patterns[i];
    const match = str.match(re);
    if (match) {
      if (i === 0 || i === 1) {
        str = str.replace(re, `${match[1]},Spicetify._renderNavLinks(${appNameArray}, true)]`);
      } else if (i === 2) {
        str = str.replace(re, `${match[1]}[${match[2]}${match[3]},Spicetify._renderNavLinks(${appNameArray}, true)].flat()`);
      }
      break;
    }
  }

  return str;
}

export function insertHomeConfig(content: string): string {
  content = replaceOnce(content, /(createDesktopHomeFeatureActivationShelfEventFactory.*?)([\w\.]+)(\.map)/, 
    (match, p1, p2, p3) => `${p1}SpicetifyHomeConfig.arrange(${p2})${p3}`);
  
  content = replaceOnce(content, /(&&"HomeShortsSectionData".*?[\],}])([a-zA-Z])(\}\)?\()/,
    (match, p1, p2, p3) => `${p1}SpicetifyHomeConfig.arrange(${p2})${p3}`);
  
  return content;
}

export function insertSidebarConfig(content: string): string {
  return replaceOnce(
    content,
    /return null!=\w+&&\w+\.totalLength(\?\w+\(\)\.createElement\(\w+,\{contextUri:)(\w+)\.uri/,
    (match, p1, p2) => `return true${p1}${p2}?.uri||""`
  );
}

export function insertExpFeatures(content: string): string {
  content = replaceOnce(content, /(function \w+\((\w+)\)\{)(\w+ \w+=\w\.name;if\("internal")/,
    (match, p1, p2, p3) => `${p1}${p2}=Spicetify.expFeatureOverride(${p2});${p3}`);

  content = replaceOnce(content, /(([\w$.]+\.fromJSON)\(\w+\)+;)(return ?[\w{}().,]+[\w$]+\.Provider,)(\{value:\{localConfiguration)/,
    (match, p1, p2, p3, p4) => `${p1}Spicetify.createInternalMap=${p2};${p3}Spicetify.RemoteConfigResolver=${p4}`);
  
  return content;
}

export function insertVersionInfo(content: string): string {
  content = replaceOnce(content, /(\w+(?:\(\))?\.createElement|\([\w$\.,]+\))\([\w\."]+,[\w{}():,]+\.containerVersion\}?\),/,
    (match, p1) => `${match}${p1}("details",{children: [
      ${p1}("summary",{children: "Spicetify v" + Spicetify.Config.version}),
      ${p1}("li",{children: "Theme: " + Spicetify.Config.current_theme + (Spicetify.Config.color_scheme && " / ") + Spicetify.Config.color_scheme}),
      ${p1}("li",{children: "Extensions: " + Spicetify.Config.extensions.join(", ")}),
      ${p1}("li",{children: "Custom apps: " + Spicetify.Config.custom_apps.join(", ")}),
      ]}),`);
  return content;
}
