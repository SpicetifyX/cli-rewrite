import { readdir, stat } from "fs/promises";
import path from "path";

export async function applyPatches() {
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
}
