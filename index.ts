import { parseArgs } from "util";
import { readConfig } from "./utils/config";
import path from "path";
import { stringify } from "ini";
import { spawn } from "child_process";
import { copyFile, exists, mkdir, readdir, rm, writeFile } from "fs/promises";
import { applyPatches } from "./utils/patcher";

(async () => {
  const { positionals } = parseArgs({
    args: Bun.argv,
    allowPositionals: true,
  });

  console.log(positionals);

  switch (positionals[2]) {
    case "config":
      if (positionals.length === 3) {
        const config = await readConfig(
          path.join(process.env.APPDATA!, "Spicetify", "config-xpui.ini"),
        );

        const textConfig = stringify(config);
        console.log(textConfig);
      }

      if (positionals.length > 3) {
        const config = await readConfig(
          path.join(process.env.APPDATA!, "Spicetify", "config-xpui.ini"),
        );

        const args = positionals.slice(3);

        const parsed = new Map<string, string>();

        for (let i = 0; i < args.length; i += 2) {
          const key: string = args[i]!;
          const value: string = args[i + 1]!;

          if (value === undefined) {
            // @ts-expect-error False positive
            console.log(key, config.Setting[key]);
            process.exit(1);
          }

          parsed.set(key, value);
        }

        for (const [key, value] of parsed) {
          if (key === "extensions") {
            const extensions = config.AdditionalOptions.extensions.split("|");
            if (value[value.length - 1] !== "-") {
              if (extensions.length === 0) {
                if (config.AdditionalOptions.extensions.length > 3) {
                  config.AdditionalOptions.extensions += `|${value}`;
                } else {
                  config.AdditionalOptions.extensions = value;
                }
              } else {
                const newExtensions = [...extensions, value].join("|");
                config.AdditionalOptions.extensions = newExtensions;
              }
            } else {
              const extName = value.slice(0, value.length - 1);
              const newExtensions = extensions
                .filter((ext) => ext != extName)
                .join("|");
              config.AdditionalOptions.extensions = newExtensions;
            }

            await writeFile(
              path.join(process.env.APPDATA!, "Spicetify", "config-xpui.ini"),
              stringify(config),
            );

            continue;
          }

          if (key === "custom_apps") {
            const custom_apps = config.AdditionalOptions.custom_apps.split("|");
            if (value[value.length - 1] !== "-") {
              if (custom_apps.length === 0) {
                if (config.AdditionalOptions.custom_apps.length > 3) {
                  config.AdditionalOptions.custom_apps += `|${value}`;
                } else {
                  config.AdditionalOptions.custom_apps = value;
                }
              } else {
                const newApps = [...custom_apps, value].join("|");
                config.AdditionalOptions.custom_apps = newApps;
              }
            } else {
              const appName = value.slice(0, value.length - 1);
              const newApps = custom_apps
                .filter((ext) => ext != appName)
                .join("|");
              config.AdditionalOptions.custom_apps = newApps;
            }

            await writeFile(
              path.join(process.env.APPDATA!, "Spicetify", "config-xpui.ini"),
              stringify(config),
            );

            continue;
          }

          // @ts-expect-error False positive
          config.Setting[key] = value;

          await writeFile(
            path.join(process.env.APPDATA!, "Spicetify", "config-xpui.ini"),
            stringify(config),
          );
        }
      }

      return;

    case "config-dir":
      spawn("explorer.exe", [path.join(process.env.APPDATA!, "Spicetify")]);

      return;

    case "backup":
      const entries = await readdir(
        path.join(process.env.APPDATA!, "Spicetify", "Backup"),
      );
      if (entries.includes("login.spa") || entries.includes("xpui.spa")) {
        console.log(
          'Backup is available run "restore backup" to restore backup or "restore backup apply" to restore backup and apply patches',
        );
        process.exit(0);
      } else {
        console.log("Backing up files");

        await Promise.all([
          await copyFile(
            path.join(process.env.APPDATA!, "Spotify", "Apps", "login.spa"),
            path.join(process.env.APPDATA!, "Spicetify", "Backup", "login.spa"),
          ),
          await copyFile(
            path.join(process.env.APPDATA!, "Spotify", "Apps", "xpui.spa"),
            path.join(process.env.APPDATA!, "Spicetify", "Backup", "xpui.spa"),
          ),
        ]);

        console.log("Backup created");
      }

      if (positionals[3] === "apply") {
        await applyPatches();
      }

      return;

    case "restore":
      if (positionals[3] === "backup") {
        console.log("Restoring backup");

        const xpuiDirPath = path.join(
          process.env.APPDATA!,
          "Spotify",
          "Apps",
          "xpui",
        );
        const loginDirPath = path.join(
          process.env.APPDATA!,
          "Spotify",
          "Apps",
          "login",
        );

        if ((await exists(xpuiDirPath)) || (await exists(loginDirPath))) {
          await rm(xpuiDirPath, {
            recursive: true,
            force: true,
          });

          await rm(loginDirPath, {
            recursive: true,
            force: true,
          });

          console.log("Cleared old patched apps");
        }

        await Promise.all([
          await copyFile(
            path.join(process.env.APPDATA!, "Spicetify", "Backup", "login.spa"),
            path.join(process.env.APPDATA!, "Spotify", "Apps", "login.spa"),
          ),
          await copyFile(
            path.join(process.env.APPDATA!, "Spicetify", "Backup", "xpui.spa"),
            path.join(process.env.APPDATA!, "Spotify", "Apps", "xpui.spa"),
          ),
        ]);

        console.log("Spotify is now restored");
      }

      if (positionals[4] === "apply") {
        await applyPatches();
      }

      return;

    case "apply":
      await applyPatches();
  }
})();
