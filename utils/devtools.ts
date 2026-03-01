import path from "node:path";
import fs from "fs/promises";

export async function toggleDevtools(enable: boolean) {
  const offlineBnkPath = path.join(
    process.env.LOCALAPPDATA!,
    "Spotify",
    "offline.bnk",
  );

  const file = await fs.open(offlineBnkPath, "r+");

  try {
    const buffer = await file.readFile();
    const fileContent = buffer.toString("utf8");

    const firstLocation = fileContent.indexOf("app-developer");
    const secondLocation = fileContent.lastIndexOf("app-developer");

    if (firstLocation === -1 || secondLocation === -1) {
      throw new Error("app-developer string not found");
    }

    const firstPatchLocation = firstLocation + 14;
    const secondPatchLocation = secondLocation + 15;

    const byteValue = enable ? 50 : 30;

    await file.write(Buffer.from([byteValue]), 0, 1, firstPatchLocation);
    await file.write(Buffer.from([byteValue]), 0, 1, secondPatchLocation);
  } finally {
    await file.close();
  }
}
