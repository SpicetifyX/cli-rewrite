import fs from "node:fs/promises";
import path from "node:path";
import {
  modifyFile,
  replace,
  replaceOnce,
  seekToCloseParen,
} from "./patch-utils";
import os from "node:os";

export async function startMinimal(extractedAppsPath: string) {
  const appPath = path.join(extractedAppsPath, "xpui");

  let cssTranslationMap: Record<string, string> = {};
  try {
    const response = await fetch(
      "https://raw.githubusercontent.com/spicetify/cli/latest/css-map.json",
    );
    if (response.ok) {
      cssTranslationMap = (await response.json()) as Record<string, string>;
    }
  } catch (e) {
    console.error("Failed to fetch CSS map:", e);
  }

  async function walk(dir: string): Promise<string[]> {
    const files = await fs.readdir(dir, { withFileTypes: true });
    const paths = await Promise.all(
      files.map(async (file) => {
        const p = path.join(dir, file.name);
        if (file.isDirectory()) return walk(p);
        return [p];
      }),
    );
    return paths.flat();
  }

  const allFiles = await walk(appPath);
  const filesToPatch = allFiles.filter((f) =>
    [".js", ".css", ".html"].includes(path.extname(f)),
  );

  console.log(`Found ${filesToPatch.length} files to patch.`);

  const concurrencyLimit = os.cpus().length;
  let running = 0;
  let index = 0;

  return new Promise<void>((resolve) => {
    async function runNext() {
      if (index >= filesToPatch.length) {
        if (running === 0) resolve();
        return;
      }

      const currentIndex = index++;
      const p = filesToPatch[currentIndex];
      const fileName = path.basename(p!);
      const extension = path.extname(p!);

      running++;

      if (currentIndex % 50 === 0 || currentIndex === filesToPatch.length - 1) {
        console.log(
          `Patching file ${currentIndex + 1}/${filesToPatch.length}: ${fileName}`,
        );
      }

      try {
        await patchFile(p!, fileName, extension, cssTranslationMap);
      } catch (e) {
        console.error(`Failed to patch ${fileName}:`, e);
      } finally {
        running--;
        runNext();
      }
    }

    for (let i = 0; i < concurrencyLimit; i++) {
      runNext();
    }
  });
}

async function patchFile(
  p: string,
  fileName: string,
  extension: string,
  cssTranslationMap: Record<string, string>,
) {
  switch (extension) {
    case ".js":
      await modifyFile(p, (content) => {
        if (
          ["xpui-modules.js", "xpui-snapshot.js", "xpui.js"].includes(fileName)
        ) {
          content = exposeAPIs_main(content);
          content = exposeAPIs_vendor(content);
        } else if (fileName === "vendor~xpui.js") {
          content = exposeAPIs_vendor(content);
        }

        content = replaceOnce(
          content,
          /(typeName\])/,
          (_, p1) => `${p1} || []`,
        );
        content = additionalPatches(content);

        if (
          [
            "dwp-top-bar.js",
            "dwp-now-playing-bar.js",
            "dwp-home-chips-row.js",
          ].includes(fileName)
        ) {
          content = replaceOnce(
            content,
            /e\.state\.cinemaState/,
            () => "e.state?.cinemaState",
          );
        }

        for (const [k, v] of Object.entries(cssTranslationMap)) {
          content = replace(content, new RegExp(k, "g"), () => v);
        }

        content = colorVariableReplaceForJS(content);
        return content;
      });
      break;

    case ".css":
      await modifyFile(p, (content) => {
        for (const [k, v] of Object.entries(cssTranslationMap)) {
          content = replace(content, new RegExp(k, "g"), () => v);
        }
        if (["xpui.css", "xpui-snapshot.css"].includes(fileName)) {
          content += `\n.main-gridContainer-fixedWidth{grid-template-columns:repeat(auto-fill,var(--column-width));}.main-cardImage-imageWrapper{background-color:var(--card-color,#333);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding-bottom:100%;position:relative;width:100%;}.main-cardImage-image,.main-card-imagePlaceholder{height:100%;left:0;position:absolute;top:0;width:100%};.main-content-view{height:100%;}\n`;
        }
        return content;
      });
      break;

    case ".html":
      await modifyFile(p, (content) => {
        let tags =
          "<link rel='stylesheet' class='userCSS' href='colors.css'>\n";
        tags += "<link rel='stylesheet' class='userCSS' href='user.css'>\n";
        tags += "<script src='helper/spicetifyWrapper.js'></script>\n";
        tags += "<!-- spicetify helpers -->\n";
        content = replace(
          content,
          /<body(\sclass="[^"]*")?>/,
          (match) => `${match}\n${tags}`,
        );
        return content;
      });
      break;
  }
}

function exposeAPIs_main(input: string): string {
  const inputContextMenuMatch = input.match(
    /.*(?:value:"contextmenu"|"[^"]*":"context-menu")/,
  );
  if (inputContextMenuMatch) {
    const croppedInput = inputContextMenuMatch[0];
    const reactMatch = croppedInput.match(/([a-zA-Z_\$][\w\$]*)\.useRef/g);
    const react = reactMatch
      ? reactMatch[reactMatch.length - 1]!.split(".")[0]
      : null;

    if (react) {
      const candidatesMatch = croppedInput.match(
        /\(\{[^}]*menu:([a-zA-Z_\$][\w\$]*),[^}]*trigger:([a-zA-Z_\$][\w\$]*),[^}]*triggerRef:([a-zA-Z_\$][\w\$]*)/,
      );
      const oldCandidatesMatch = croppedInput.match(
        /([a-zA-Z_\$][\w\$]*)=[\w_$]+\.menu[^}]*,([a-zA-Z_\$][\w\$]*)=[\w_$]+\.trigger[^}]*,([a-zA-Z_\$][\w\$]*)=[\w_$]+\.triggerRef/,
      );

      let menu, trigger, target;
      if (oldCandidatesMatch) {
        [menu, trigger, target] = [
          oldCandidatesMatch[1],
          oldCandidatesMatch[2],
          oldCandidatesMatch[3],
        ];
      } else if (candidatesMatch) {
        [menu, trigger, target] = [
          candidatesMatch[1],
          candidatesMatch[2],
          candidatesMatch[3],
        ];
      } else {
        [menu, trigger, target] = ["e.menu", "e.trigger", "e.triggerRef"];
      }

      input = replace(
        input,
        /\(0,([\w_$]+)\.jsx\)\((?:[\w_$]+\.[\w_$]+,\{value:"contextmenu"[^}]+\}\)\}\)|"[\w-]+",\{[^}]+:"context-menu"[^}]+\}\))/,
        (match, p1) =>
          `(0,${p1}.jsx)((Spicetify.ContextMenuV2._context||(Spicetify.ContextMenuV2._context=${react}.createContext(null))).Provider,{value:{props:${trigger}?.props,trigger:${trigger},target:${target}},children:${match}})`,
      );
    }
  }

  const xpuiPatches = [
    {
      name: "showNotification",
      regex: /(?:\w+ |,)([\w$]+)=(\([\w$]+=[\w$]+\.dispatch)/,
      repl: (_: unknown, p1: string, p2: string) =>
        `;globalThis.Spicetify.showNotification=(message,isError=false,msTimeout)=>${p1}({message,feedbackType:isError?"ERROR":"NOTICE",msTimeout});const ${p1}=${p2}`,
    },
    {
      name: "Remove list of exclusive shows",
      regex: /\["spotify:show.+?\]/,
      repl: () => "[]",
    },
    {
      name: "Remove Star Wars easter eggs",
      regex:
        /\w+\(\)\.createElement\(\w+,\{onChange:this\.handleSaberStateChange\}\),/,
      repl: () => "",
    },
    { name: "Remove data-testid", regex: /"data-testid":/, repl: () => `"":` },
    {
      name: "Expose PlatformAPI",
      regex:
        /((?:setTitlebarHeight|registerFactory)[\w(){}<>:.,&$!=;""?!#% ]+)(\{version:[a-zA-Z_\$][\w\$]*,)/,
      repl: (_: unknown, p1: string, p2: string) =>
        `${p1}Spicetify._platform=${p2}`,
    },
    {
      name: "Redux store",
      regex:
        /(,[\w$]+=)(([$\w,.:=;(){}]+\(\{session:[\w$]+,features:[\w$]+,seoExperiment:[\w$]+\}))/,
      repl: (_: unknown, p1: string, p2: string) =>
        `${p1}Spicetify.Platform.ReduxStore=${p2}`,
    },
    {
      name: "React Component: Platform Provider",
      regex:
        /(,[$\w]+=)((function\([\w$]{1}\)\{var [\w$]+=[\w$]+\.platform,[\w$]+=[\w$]+\.children,)|(\(\{platform:[\w$]+,children:[\w$]+\}\)=>\{))/,
      repl: (_: unknown, p1: string, p2: string) =>
        `${p1}Spicetify.ReactComponent.PlatformProvider=${p2}`,
    },
    {
      name: "Prevent breaking popupLyrics",
      regex:
        /document.pictureInPictureElement&&\(\w+.current=[!\w]+,document\.exitPictureInPicture\(\)\),\w+\.current=null/,
      repl: () => "",
    },
    {
      name: "Spotify Custom Snackbar Interfaces (<=1.2.37)",
      regex: /\b\w\s*\(\)\s*[^;,]*enqueueCustomSnackbar:\s*(\w)\s*[^;]*;/,
      repl: (m: string, p1: string) =>
        `${m}Spicetify.Snackbar.enqueueCustomSnackbar=${p1};`,
    },
    {
      name: "Spotify Custom Snackbar Interfaces (>=1.2.38)",
      regex: /(=)[^=]*\(\)\.enqueueCustomSnackbar;/,
      repl: (_: unknown, p1: string) =>
        `=Spicetify.Snackbar.enqueueCustomSnackbar${p1};`,
    },
    {
      name: "Spotify Image Snackbar Interface",
      regex: /(=)(\(\({[^}]*,\s*imageSrc)/,
      repl: (_: unknown, p1: string, p2: string) =>
        `${p1}Spicetify.Snackbar.enqueueImageSnackbar=${p2}`,
    },
    {
      name: "React Component: Navigation for navLinks",
      regex:
        /(;const [\w\d]+=)((?:\(0,[\w\d]+\.memo\))[\(\d,\w\.\){:}=]+\=[\d\w]+\.[\d\w]+\.getLocaleForURLPath\(\))/,
      repl: (_: unknown, p1: string, p2: string) =>
        `${p1}Spicetify.ReactComponent.Navigation=${p2}`,
      once: true,
    },
    {
      name: "Context Menu V2",
      regex: /("Menu".+?children:)([\w$][\w$\d]*)/,
      repl: (_: unknown, p1: string, p2: string) =>
        `${p1}[Spicetify.ContextMenuV2.renderItems(),${p2}].flat()`,
    },
  ];

  for (const patch of xpuiPatches) {
    if (patch.once) {
      input = replaceOnce(input, patch.regex, patch.repl);
    } else {
      input = replace(input, patch.regex, patch.repl);
    }
  }

  return input;
}

function exposeAPIs_vendor(input: string): string {
  input = replace(
    input,
    /,(\w+)\.prototype\.toAppType/,
    (match, p1) => `,(globalThis.Spicetify.URI=${p1})${match}`,
  );

  const vendorPatches = [
    {
      name: "Spicetify.URI",
      regex: /,(\w+)\.prototype\.toAppType/,
      repl: (m: string, p1: string) => `,(globalThis.Spicetify.URI=${p1})${m}`,
    },
    {
      name: "Map styled-components classes",
      regex: /(\w+ [\w$_]+)=[\w$_]+\([\w$_]+>>>0\)/,
      repl: (_: unknown, p1: string) =>
        `${p1}=Spicetify._getStyledClassName(arguments,this)`,
    },
    {
      name: "Tippy.js",
      regex: /([\w\$_]+)\.setDefaultProps=/,
      repl: (m: string, p1: string) => `Spicetify.Tippy=${p1};${m}`,
    },
    {
      name: "Flipper components",
      regex:
        /([\w$]+)=((?:function|\()([\w$.,{}()= ]+(?:springConfig|overshootClamping)){2})/,
      repl: (_: unknown, p1: string, p2: string) =>
        `${p1}=Spicetify.ReactFlipToolkit.spring=${p2}`,
    },
    {
      name: "Snackbar",
      regex:
        /\w+\s*=\s*\w\.call\(this,[^)]+\)\s*\|\|\s*this\)\.enqueueSnackbar/,
      repl: (m: string) => `Spicetify.Snackbar=${m}`,
    },
  ];

  for (const patch of vendorPatches) {
    input = replace(input, patch.regex, patch.repl);
  }

  if (!input.includes("Spicetify.URI")) {
    const uriObjMatch = input.match(
      /(?:class ([\w$_]+)\{constructor|([\w$_]+)=function\(\)\{function ?[\w$_]+)\([\w$.,={}]+\)\{[\w !?:=.,>&(){}[\];]*this\.hasBase62Id/,
    );
    if (uriObjMatch) {
      let uriName = uriObjMatch[1] || uriObjMatch[2];
      const uriContent = seekToCloseParen(
        input,
        /\{(?:constructor|function ?[\w$_]+)\([\w$.,={}]+\)\{[\w !?:=.,>&(){}[\];]*this\.hasBase62Id/,
        "{",
        "}",
      );
      if (uriContent) {
        if (!uriObjMatch[1]) {
          uriName += "()";
        }
        input = input.replace(
          uriContent,
          `${uriContent};Spicetify.URI=${uriName};`,
        );
      }
    }
  }

  return input;
}

function additionalPatches(input: string): string {
  const patches = [
    {
      name: "GraphQL definitions (<=1.2.30)",
      regex:
        /((?:\w+ ?)?[\w$]+=)(\{kind:"Document",definitions:\[\{(?:\w+:[\w"]+,)+name:\{(?:\w+:[\w"]+,?)+value:("\w+"))/,
      repl: (_: unknown, p1: string, p2: string, p3: string) =>
        `${p1}Spicetify.GraphQL.Definitions[${p3}]=${p2}`,
    },
    {
      name: "GraphQL definitions (>=1.2.31)",
      regex:
        /(=new [\w_\$][\w_\$\d]*\.[\w_\$][\w_\$\d]*\("(\w+)","(query|mutation)","[\w\d]{64}",null\))/,
      repl: (_: unknown, p1: string, p2: string) =>
        `=Spicetify.GraphQL.Definitions["${p2}"]${p1}`,
    },
  ];

  for (const patch of patches) {
    input = replace(input, patch.regex, patch.repl);
  }
  return input;
}

function colorVariableReplaceForJS(content: string): string {
  const patches = [
    {
      regex: /"#1db954"/,
      repl: () =>
        ` getComputedStyle(document.body).getPropertyValue("--spice-button").trim()`,
    },
    {
      regex: /"#b3b3b3"/,
      repl: () =>
        ` getComputedStyle(document.body).getPropertyValue("--spice-subtext").trim()`,
    },
    {
      regex: /"#ffffff"/,
      repl: () =>
        ` getComputedStyle(document.body).getPropertyValue("--spice-text").trim()`,
    },
    { regex: /color:"white"/, repl: () => `color:"var(--spice-text)"` },
  ];
  for (const patch of patches) {
    content = replace(content, patch.regex, patch.repl);
  }
  return content;
}
