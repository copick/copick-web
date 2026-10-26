/**
 * Licences of the packages bundled into web workers, appended to the licence file Vite writes for the main bundle
 * (`build.license`). Vite builds workers separately and lists only the main bundle's packages, so the isosurface
 * worker's vtk.js (BSD-3-Clause) and its dependencies would be missing from it.
 */

import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

interface Entry {
  name: string;
  version: string;
  license?: string;
  text?: string;
}

const LICENSE_FILE = /^(licen[cs]e|copying)(\..*)?$/i;

/** The package a bundled module belongs to: the nearest package.json with a name. */
function packageOf(moduleId: string): Entry | null {
  let dir = path.dirname(moduleId.split("?")[0]);
  while (dir.includes("node_modules")) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
      if (pkg.name) {
        const licenseFile = fs
          .readdirSync(dir)
          .find((f) => LICENSE_FILE.test(f));
        return {
          name: pkg.name,
          version: pkg.version ?? "0.0.0",
          license: pkg.license,
          text: licenseFile
            ? fs.readFileSync(path.join(dir, licenseFile), "utf8").trim()
            : undefined,
        };
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * `collect()` goes in `worker.plugins` and records the workers' packages; `append` goes in `plugins` and adds them
 * to `fileName` (Vite's licence file) once the build is written, in the same format.
 */
export function workerLicenses(fileName: string): {
  collect: () => Plugin;
  append: Plugin;
} {
  const entries = new Map<string, Entry>();
  let outDir = "";
  return {
    collect: () => ({
      name: "worker-licenses:collect",
      generateBundle(_, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== "chunk") continue;
          for (const id of chunk.moduleIds) {
            if (id.startsWith("\0") || !id.includes("node_modules")) continue;
            const entry = packageOf(id);
            if (entry) entries.set(`${entry.name}@${entry.version}`, entry);
          }
        }
      },
    }),
    append: {
      name: "worker-licenses",
      apply: "build",
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir);
      },
      closeBundle() {
        const target = path.join(outDir, fileName);
        if (!fs.existsSync(target)) return;
        let text = fs.readFileSync(target, "utf8");
        const missing = [...entries.values()]
          .filter((e) => !text.includes(`\n## ${e.name} - ${e.version}`))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (missing.length === 0) return;
        text += "\nThe app's web workers bundle these as well:\n";
        for (const e of missing) {
          text += `\n## ${e.name} - ${e.version}${e.license ? ` (${e.license})` : ""}\n`;
          if (e.text) text += `\n${e.text}\n`;
        }
        fs.writeFileSync(target, text);
      },
    },
  };
}
