import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const candidates = [
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
];

const source = candidates.map((p) => resolve(p)).find((p) => existsSync(p));

if (!source) {
  console.error("pdf.worker.min.mjs not found. Run npm install first.");
  process.exit(1);
}

const target = resolve("public/pdf.worker.min.mjs");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`copied ${source} -> ${target}`);
