import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export type FileDigest = { bytes: number; sha256: string };
export async function inventory(root: string, prefix = ""): Promise<Record<string, FileDigest>> {
  const files: Record<string, FileDigest> = {};
  for (const name of (await readdir(join(root, prefix))).sort()) {
    if (!prefix && name === "manifest.json") continue;
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = await lstat(join(root, path));
    if (stat.isDirectory()) Object.assign(files, await inventory(root, path));
    else if (stat.isFile()) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(join(root, path))) hash.update(chunk);
      files[path] = { bytes: stat.size, sha256: hash.digest("hex") };
    } else throw new Error(`snapshot contains a non-regular file: ${path}`);
  }
  return files;
}

export async function checkFiles(root: string, expected: Record<string, FileDigest>): Promise<void> {
  const actual = await inventory(root);
  const paths = Object.keys(actual);
  if (paths.length !== Object.keys(expected).length || paths.some((p) => actual[p]!.bytes !== expected[p]?.bytes || actual[p]!.sha256 !== expected[p]?.sha256)) {
    throw new Error("snapshot file inventory or SHA-256 mismatch");
  }
}
