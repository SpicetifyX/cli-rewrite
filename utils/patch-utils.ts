import fs from "node:fs/promises";
import path from "node:path";

export type Modifier = (content: string) => string | Promise<string>;

export class PatchManager {
  private patches = new Map<string, Modifier[]>();

  addPatch(filePath: string, modifier: Modifier) {
    const normalized = path.normalize(filePath);
    if (!this.patches.has(normalized)) {
      this.patches.set(normalized, []);
    }
    this.patches.get(normalized)!.push(modifier);
  }

  async run(allFiles: string[], globalModifier?: Modifier) {
    const uniqueFiles = new Set([...allFiles, ...this.patches.keys()]);
    const concurrencyLimit = require("node:os").cpus().length * 2;
    const queue = Array.from(uniqueFiles);

    const worker = async () => {
      while (queue.length > 0) {
        const filePath = queue.shift();
        if (!filePath) break;

        try {
          const raw = await fs.readFile(filePath, "utf8");
          let content = raw;

          const modifiers = this.patches.get(path.normalize(filePath));
          if (modifiers) {
            for (const mod of modifiers) {
              content = await mod(content);
            }
          }

          if (globalModifier) {
            content = await globalModifier(content);
          }

          if (content !== raw) {
            await fs.writeFile(filePath, content, { mode: 0o700 });
          }
        } catch (e) {
          console.log(e);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrencyLimit }, worker));
  }
}

export async function modifyFile(
  filePath: string,
  repl: (content: string) => string | Promise<string>,
) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const content = await repl(raw);
    if (content !== raw) {
      await fs.writeFile(filePath, content, { mode: 0o700 });
    }
  } catch (err) {
    console.error(`Error modifying file ${filePath}:`, err);
  }
}

export function replace(
  content: string,
  pattern: string | RegExp,
  repl: (...submatches: string[]) => string,
): string {
  let re: RegExp;
  if (typeof pattern === "string") {
    re = new RegExp(pattern, "g");
  } else {
    // If it's a RegExp without the global flag, create a new one with it
    if (!pattern.global) {
      re = new RegExp(pattern.source, pattern.flags + "g");
    } else {
      re = pattern;
    }
  }

  return content.replace(re, (match, ...args) => {
    // The last two arguments are offset and string.
    // All arguments before that are the capture groups.
    const submatches = [match, ...args.slice(0, -2)];
    return repl(...submatches);
  });
}

export function replaceOnce(
  content: string,
  pattern: string | RegExp,
  repl: (...submatches: string[]) => string,
): string {
  if (typeof pattern === "string") {
    const index = content.indexOf(pattern);
    if (index === -1) return content;
    // Simple string replacement if possible
    const match = [pattern]; // incomplete submatches but often enough
    return (
      content.slice(0, index) +
      repl(pattern) +
      content.slice(index + pattern.length)
    );
  } else {
    let firstMatch = true;
    return content.replace(pattern, (match, ...args) => {
      if (firstMatch) {
        firstMatch = false;
        const submatches = [match, ...args.slice(0, -2)];
        return repl(...submatches);
      }
      return match;
    });
  }
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
