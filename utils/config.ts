import { readFile } from "node:fs/promises";
import { parse } from "ini";

type Config = {
  Setting: {
    replace_colors: string;
    check_spicetify_update: string;
    prefs_path: string;
    current_theme: string;
    color_scheme: string;
    inject_theme_js: string;
    inject_css: string;
    overwrite_assets: string;
    spotify_launch_flags: string;
    always_enable_devtools: string;
    spotify_path: string;
  };
  Preprocesses: {
    disable_sentry: string;
    disable_ui_logging: string;
    remove_rtl_rule: string;
    expose_apis: string;
  };
  AdditionalOptions: {
    experimental_features: string;
    extensions: string;
    custom_apps: string;
    sidebar_config: string;
    home_config: string;
  };
  Patch: {};
  Backup: {
    version: string;
    with: string;
  };
};

export async function readConfig(path: string): Promise<Config> {
  const text = await readFile(path, {
    encoding: "utf8",
  });

  return parse(text) as Config;
}
