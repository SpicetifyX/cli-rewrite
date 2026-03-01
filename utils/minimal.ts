import { replace, replaceOnce, seekToCloseParen } from "./patch-utils";

const RE_CONTEXT_MENU = /(?:value:"contextmenu"|"[^"]*":"context-menu")/;
const RE_USE_REF = /([a-zA-Z_\$][\w\$]*)\.useRef/g;
const RE_CANDIDATES =
  /\(\{[^}]*menu:([a-zA-Z_\$][\w\$]*),[^}]*trigger:([a-zA-Z_\$][\w\$]*),[^}]*triggerRef:([a-zA-Z_\$][\w\$]*)/;
const RE_OLD_CANDIDATES =
  /([a-zA-Z_\$][\w\$]*)=[\w_$]+\.menu[^}]*,([a-zA-Z_\$][\w\$]*)=[\w_$]+\.trigger[^}]*,([a-zA-Z_\$][\w\$]*)=[\w_$]+\.triggerRef/;
const RE_JSX_MENU =
  /\(0,([\w_$]+)\.jsx\)\((?:[\w_$]+\.[\w_$]+,\{value:"contextmenu"[^}]+\}\)\}\)|"[\w-]+",\{[^}]+:"context-menu"[^}]+\}\))/g;

function exposeAPIs_main(input: string): string {
  const match = input.match(RE_CONTEXT_MENU);
  if (match && match.index !== undefined) {
    const croppedInput = input.slice(0, match.index);
    const reactMatch = croppedInput.match(RE_USE_REF);
    const react = reactMatch
      ? reactMatch[reactMatch.length - 1]!.split(".")[0]
      : null;

    if (react) {
      const cMatch = croppedInput.match(RE_CANDIDATES);
      const ocMatch = croppedInput.match(RE_OLD_CANDIDATES);

      let menu, trigger, target;
      if (ocMatch) {
        [menu, trigger, target] = [ocMatch[1], ocMatch[2], ocMatch[3]];
      } else if (cMatch) {
        [menu, trigger, target] = [cMatch[1], cMatch[2], cMatch[3]];
      } else {
        [menu, trigger, target] = ["e.menu", "e.trigger", "e.triggerRef"];
      }

      input = replace(
        input,
        RE_JSX_MENU,
        (m, p1) =>
          `(0,${p1}.jsx)((Spicetify.ContextMenuV2._context||(Spicetify.ContextMenuV2._context=${react}.createContext(null))).Provider,{value:{props:${trigger}?.props,trigger:${trigger},target:${target}},children:${m}})`,
      );
    }
  }

  return applyPatches(input, [
    {
      name: "showNotification",
      regex: /(?:\w+ |,)([\w$]+)=(\([\w$]+=[\w$]+\.dispatch)/,
      repl: (_, p1, p2) =>
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
      regex:
        /((?:setTitlebarHeight|registerFactory)[\w(){}<>:.,&$!=;""?!#% ]+)(\{version:[a-zA-Z_\$][\w\$]*,)/,
      repl: (_, p1, p2) => `${p1}Spicetify._platform=${p2}`,
    },
    {
      regex:
        /(,[\w$]+=)(([$\w,.:=;(){}]+\(\{session:[\w$]+,features:[\w$]+,seoExperiment:[\w$]+\}))/,
      repl: (_, p1, p2) => `${p1}Spicetify.Platform.ReduxStore=${p2}`,
    },
    {
      regex:
        /(,[$\w]+=)((function\([\w$]{1}\)\{var [\w$]+=[\w$]+\.platform,[\w$]+=[\w$]+\.children,)|(\(\{platform:[\w$]+,children:[\w$]+\}\)=>\{))/,
      repl: (_, p1, p2) =>
        `${p1}Spicetify.ReactComponent.PlatformProvider=${p2}`,
    },
    {
      regex:
        /document.pictureInPictureElement&&\(\w+.current=[!\w]+,document\.exitPictureInPicture\(\)\),\w+\.current=null/,
      repl: () => "",
    },
    {
      regex: /\b\w\s*\(\)\s*[^;,]*enqueueCustomSnackbar:\s*(\w)\s*[^;]*;/,
      repl: (m, p1) => `${m}Spicetify.Snackbar.enqueueCustomSnackbar=${p1};`,
    },
    {
      regex: /(=)[^=]*\(\)\.enqueueCustomSnackbar;/,
      repl: (_, p1) => `=Spicetify.Snackbar.enqueueCustomSnackbar${p1};`,
    },
    {
      regex: /(=)(\(\({[^}]*,\s*imageSrc)/,
      repl: (_, p1, p2) => `${p1}Spicetify.Snackbar.enqueueImageSnackbar=${p2}`,
    },
    {
      regex:
        /(;const [\w\d]+=)((?:\(0,[\w\d]+\.memo\))[\(\d,\w\.\){:}=]+\=[\d\w]+\.[\d\w]+\.getLocaleForURLPath\(\))/,
      repl: (_, p1, p2) => `${p1}Spicetify.ReactComponent.Navigation=${p2}`,
      once: true,
    },
    {
      regex: /("Menu".+?children:)([\w$][\w$\d]*)/,
      repl: (_, p1, p2) =>
        `${p1}[Spicetify.ContextMenuV2.renderItems(),${p2}].flat()`,
    },
  ]);
}

const RE_URI_PROTO = /,(\w+)\.prototype\.toAppType/g;
const RE_URI_OBJ =
  /(?:class ([\w$_]+)\{constructor|([\w$_]+)=function\(\)\{function ?[\w$_]+)\([\w$.,={}]+\)\{[\w !?:=.,>&(){}[\];]*this\.hasBase62Id/;
const RE_URI_CONTENT =
  /\{(?:constructor|function ?[\w$_]+)\([\w$.,={}]+\)\{[\w !?:=.,>&(){}[\];]*this\.hasBase62Id/;

function exposeAPIs_vendor(input: string): string {
  input = replace(
    input,
    RE_URI_PROTO,
    (match, p1) => `,(globalThis.Spicetify.URI=${p1})${match}`,
  );

  input = applyPatches(input, [
    {
      regex: RE_URI_PROTO,
      repl: (m, p1) => `,(globalThis.Spicetify.URI=${p1})${m}`,
    },
    {
      regex: /(\w+ [\w$_]+)=[\w$_]+\([\w$_]+>>>0\)/,
      repl: (_, p1) => `${p1}=Spicetify._getStyledClassName(arguments,this)`,
    },
    {
      regex: /([\w\$_]+)\.setDefaultProps=/,
      repl: (m, p1) => `Spicetify.Tippy=${p1};${m}`,
    },
    {
      regex:
        /([\w$]+)=((?:function|\()([\w$.,{}()= ]+(?:springConfig|overshootClamping)){2})/,
      repl: (_, p1, p2) => `${p1}=Spicetify.ReactFlipToolkit.spring=${p2}`,
    },
    {
      regex:
        /\w+\s*=\s*\w\.call\(this,[^)]+\)\s*\|\|\s*this\)\.enqueueSnackbar/,
      repl: (m) => `Spicetify.Snackbar=${m}`,
    },
  ]);

  if (!input.includes("Spicetify.URI")) {
    const uriObjMatch = input.match(RE_URI_OBJ);
    if (uriObjMatch) {
      let uriName = uriObjMatch[1] || uriObjMatch[2];
      const uriContent = seekToCloseParen(input, RE_URI_CONTENT, "{", "}");
      if (uriContent) {
        if (!uriObjMatch[1]) uriName += "()";
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
  return applyPatches(input, [
    {
      regex:
        /((?:\w+ ?)?[\w$]+=)(\{kind:"Document",definitions:\[\{(?:\w+:[\w"]+,)+name:\{(?:\w+:[\w"]+,?)+value:("\w+"))/,
      repl: (_, p1, p2, p3) =>
        `${p1}Spicetify.GraphQL.Definitions[${p3}]=${p2}`,
    },
    {
      regex:
        /(=new [\w_\$][\w_\$\d]*\.[\w_\$][\w_\$\d]*\("(\w+)","(query|mutation)","[\w\d]{64}",null\))/,
      repl: (_, p1, p2) => `=Spicetify.GraphQL.Definitions["${p2}"]${p1}`,
    },
  ]);
}

function colorVariableReplaceForJS(content: string): string {
  return applyPatches(content, [
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
  ]);
}

function applyPatches(
  input: string,
  patches: {
    regex: RegExp | string;
    repl: (...args: string[]) => string;
    name?: string;
    once?: boolean;
  }[],
): string {
  for (const patch of patches) {
    const re =
      typeof patch.regex === "string"
        ? new RegExp(patch.regex, patch.once ? "" : "g")
        : patch.regex;
    if (patch.once) {
      input = replaceOnce(input, re, patch.repl);
    } else {
      input = replace(input, re, patch.repl);
    }
  }
  return input;
}

export function getMinimalModifiers() {
  return {
    js: (content: string, fileName: string) => {
      if (
        ["xpui-modules.js", "xpui-snapshot.js", "xpui.js"].includes(fileName)
      ) {
        content = exposeAPIs_main(content);
        content = exposeAPIs_vendor(content);
      } else if (fileName === "vendor~xpui.js") {
        content = exposeAPIs_vendor(content);
      }

      content = replaceOnce(content, /(typeName\])/, (_, p1) => `${p1} || []`);
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

      content = colorVariableReplaceForJS(content);
      return content;
    },
    css: (content: string, fileName: string) => {
      if (["xpui.css", "xpui-snapshot.css"].includes(fileName)) {
        content += `\n.main-gridContainer-fixedWidth{grid-template-columns:repeat(auto-fill,var(--column-width));}.main-cardImage-imageWrapper{background-color:var(--card-color,#333);border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding-bottom:100%;position:relative;width:100%;}.main-cardImage-image,.main-card-imagePlaceholder{height:100%;left:0;position:absolute;top:0;width:100%};.main-content-view{height:100%;}\n`;
      }
      return content;
    },
    html: (content: string) => {
      let tags = "<link rel='stylesheet' class='userCSS' href='colors.css'>\n";
      tags += "<link rel='stylesheet' class='userCSS' href='user.css'>\n";
      tags += "<script src='helper/spicetifyWrapper.js'></script>\n";
      tags += "<!-- spicetify helpers -->\n";
      return replace(
        content,
        /<body(\sclass="[^"]*")?>/,
        (match) => `${match}\n${tags}`,
      );
    },
  };
}
