import fs from "node:fs/promises";
import path from "node:path";

export async function modifyFile(
  filePath: string,
  repl: (content: string) => string | Promise<string>,
) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const content = await repl(raw);
    await fs.writeFile(filePath, content, { mode: 0o700 });
  } catch (err) {
    console.error(`Error modifying file ${filePath}:`, err);
  }
}

export function replace(
  content: string,
  pattern: string | RegExp,
  repl: (...submatches: string[]) => string,
): string {
  const re = typeof pattern === "string" ? new RegExp(pattern, "g") : pattern;
  return content.replace(re, (match, ...args) => {
    const submatches = [match, ...args.slice(0, -2)];
    return repl(...submatches);
  });
}

export function replaceOnce(
  content: string,
  pattern: string | RegExp,
  repl: (...submatches: string[]) => string,
): string {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  let firstMatch = true;
  return content.replace(re, (match, ...args) => {
    if (firstMatch) {
      firstMatch = false;
      const submatches = [match, ...args.slice(0, -2)];
      return repl(...submatches);
    }
    return match;
  });
}

export function seekToCloseParen(
  content: string,
  pattern: string | RegExp,
  leftChar: string,
  rightChar: string,
): string {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  const match = content.match(re);
  if (match && match.index !== undefined) {
    const start = match.index;
    let end = start;
    let count = 0;
    let init = false;

    while (end < content.length) {
      if (content[end] === leftChar) {
        count++;
        init = true;
      } else if (content[end] === rightChar) {
        count--;
      }
      end++;
      if (count === 0 && init) {
        break;
      }
    }
    return content.slice(start, end);
  }
  return "";
}

export async function copyFile(srcPath: string, destDir: string) {
  await fs.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, path.basename(srcPath));
  await fs.copyFile(srcPath, destPath);
}

export async function copyRecursive(src: string, dest: string) {
  await fs.cp(src, dest, { recursive: true });
}
