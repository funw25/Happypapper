import { writeFile } from "node:fs/promises";

const themes = [
  "A claim is useful when a reader can inspect its evidence.",
  "A margin note can point to the sentence that raised the question.",
  "Reliable experiments use fixed inputs and record their assumptions.",
  "Clear language gives the reader room to consider the argument.",
  "A paper can be read and discussed by different people at different times.",
  "Background reading helps a group agree on what remains unresolved.",
  "The purpose of an annotation is to recover context later.",
];

function pageContent(page) {
  return Array.from({ length: 55 }, (_, index) => {
    const sentence = themes[(index + page) % themes.length];
    const y = 744 - 13 * index;
    return "BT /F1 10 Tf 56 " + y + " Td (Page " + page + ", note " + (index + 1) + ": " + sentence + ") Tj ET";
  }).join("\n");
}

function createPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [ 4 0 R 6 0 R 8 0 R 10 0 R 12 0 R ] /Count 5 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 1; page <= 5; page++) {
    const contentsId = objects.length + 2;
    const stream = pageContent(page);
    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents " + contentsId + " 0 R >>",
      "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream",
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, payload] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += (index + 1) + " 0 obj\n" + payload + "\nendobj\n";
  }
  const xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 " + offsets.length + "\n0000000000 65535 f \n";
  for (const position of offsets.slice(1)) {
    pdf += String(position).padStart(10, "0") + " 00000 n \n";
  }
  return pdf + "trailer\n<< /Size " + offsets.length + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
}

await writeFile(new URL("./F01-reading-notes.pdf", import.meta.url), createPdf());
