import mammoth from "mammoth";
import AdmZip from "adm-zip";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import type { Report, Source } from "../shared/types.js";
export async function extractDocument(name: string, bytes: Buffer) {
  if (bytes.length > 10 * 1024 * 1024)
    throw new Error("Documents must be smaller than 10 MB.");
  const ext = name.split(".").pop()?.toLowerCase();
  let text = "";
  if (ext === "txt" || ext === "md") text = bytes.toString("utf8");
  else if (ext === "docx") {
    const entries = new AdmZip(bytes).getEntries();
    if (
      entries.length > 4096 ||
      entries.reduce((n, e) => n + e.header.size, 0) > 40 * 1024 * 1024 ||
      entries.some((e) => e.entryName.endsWith("vbaProject.bin"))
    )
      throw new Error("This document archive is too large or contains macros.");
    text = (await mammoth.extractRawText({ buffer: bytes })).value;
  } else if (ext === "pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    const pdf = await loading.promise;
    try {
      if (pdf.numPages > 150)
        throw new Error("PDFs must contain at most 150 pages.");
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        pages.push(
          content.items.map((x) => ("str" in x ? x.str : "")).join(" "),
        );
      }
      text = pages.join("\n\n");
    } finally {
      await loading.destroy();
    }
    if (text.trim().length < 40)
      throw new Error(
        "This PDF has no extractable text. Scanned PDFs need OCR and are not supported yet.",
      );
  } else
    throw new Error("Upload a TXT, Markdown, DOCX or text-based PDF file.");
  text = text.replace(/\u0000/g, "").trim();
  if (!text) throw new Error("The file has no readable text.");
  if (text.length > 400000)
    throw new Error("The extracted document exceeds 400,000 characters.");
  return { text, format: ext! };
}
export function markdownReport(
  report: Report,
  sources: Source[],
  language: "English" | "Chinese" = "English",
) {
  const labels =
    language === "Chinese"
      ? { sources: "资料来源", limitations: "局限与说明" }
      : { sources: "Sources", limitations: "Limitations" };
  const lines = [`# ${report.title}`, ""];
  for (const section of report.sections) {
    lines.push(
      `## ${section.heading}`,
      "",
      ...section.paragraphs.flatMap((p) => [p, ""]),
    );
    if (section.sourceIds.length)
      lines.push(
        labels.sources +
          ": " +
          section.sourceIds
            .map((id) => `[${sources.findIndex((s) => s.id === id) + 1}]`)
            .join(", "),
        "",
      );
  }
  if (report.limitations.length)
    lines.push(
      "## " + labels.limitations,
      "",
      ...report.limitations.flatMap((p) => [p, ""]),
    );
  lines.push(
    "## " + labels.sources,
    "",
    ...sources.map(
      (s, i) => `[${i + 1}] ${s.name}${s.url ? " — " + s.url : ""}`,
    ),
    "",
  );
  return lines.join("\n");
}
export async function docxReport(
  report: Report,
  sources: Source[],
  language: "English" | "Chinese" = "English",
) {
  const labels =
    language === "Chinese"
      ? { sources: "资料来源", limitations: "局限与说明" }
      : { sources: "Sources", limitations: "Limitations" };
  const body: Paragraph[] = [
    new Paragraph({ text: report.title, heading: HeadingLevel.TITLE }),
  ];
  for (const section of report.sections) {
    body.push(
      new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }),
    );
    for (const p of section.paragraphs) body.push(new Paragraph({ text: p }));
    if (section.sourceIds.length)
      body.push(
        new Paragraph({
          children: [
            new TextRun({
              text:
                labels.sources +
                ": " +
                section.sourceIds
                  .map((id) => `[${sources.findIndex((s) => s.id === id) + 1}]`)
                  .join(", "),
              italics: true,
            }),
          ],
        }),
      );
  }
  if (report.limitations.length) {
    body.push(
      new Paragraph({
        text: labels.limitations,
        heading: HeadingLevel.HEADING_1,
      }),
    );
    for (const t of report.limitations) body.push(new Paragraph({ text: t }));
  }
  body.push(
    new Paragraph({ text: labels.sources, heading: HeadingLevel.HEADING_1 }),
  );
  sources.forEach((s, i) =>
    body.push(
      new Paragraph({
        text: `[${i + 1}] ${s.name}${s.url ? " — " + s.url : ""}`,
      }),
    ),
  );
  const doc = new Document({
    creator: "Personal Sovereign Agent",
    title: report.title,
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24, color: "000000" },
          paragraph: { spacing: { after: 160, line: 320 } },
        },
        title: {
          run: {
            font: "Times New Roman",
            size: 40,
            bold: true,
            color: "000000",
          },
          paragraph: { spacing: { after: 280 } },
        },
        heading1: {
          run: {
            font: "Times New Roman",
            size: 28,
            bold: true,
            color: "000000",
          },
          paragraph: { spacing: { before: 240, after: 160 }, keepNext: true },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
