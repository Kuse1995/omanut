// Document text extraction for the Company Brain.
// Real extraction for the formats owners actually upload:
//   PDF  -> pdf.js (via unpdf, serverless-safe)
//   DOCX -> JSZip + word/document.xml (paragraph-aware)
//   XLSX -> SheetJS (sheet-per-section CSV)
//   TXT/CSV -> utf-8 decode
// Legacy binary .doc is not supported — the caller returns a helpful hint.

import { extractText, getDocumentProxy } from "https://esm.sh/unpdf";
import JSZip from "https://esm.sh/jszip@3.10.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

export function cleanExtracted(s: string): string {
  return String(s || "")
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [String(text || "")];
  const joined = pages
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join("\n\n");
  return cleanExtracted(joined);
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("not a valid docx (missing word/document.xml)");
  const xml = await entry.async("string");
  const out = xml
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, " ")
    .replace(/<\/w:p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  return cleanExtracted(out);
}

export function extractXlsxText(bytes: Uint8Array): string {
  const wb = XLSX.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws).trim();
    if (csv) parts.push("# Sheet: " + name + "\n" + csv);
  }
  return cleanExtracted(parts.join("\n\n"));
}

export function extractPlainText(bytes: Uint8Array): string {
  return cleanExtracted(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}

export async function extractDocumentText(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<{ text: string; format: string } | null> {
  const name = String(filename || "").toLowerCase();
  const type = String(mime || "").toLowerCase();
  const is = (ext: string) => name.endsWith("." + ext);
  if (type.includes("pdf") || is("pdf")) {
    return { text: await extractPdfText(bytes), format: "pdf" };
  }
  if (type.includes("wordprocessingml") || is("docx") || (type.includes("word") && !is("doc"))) {
    return { text: await extractDocxText(bytes), format: "docx" };
  }
  if (type.includes("spreadsheetml") || is("xlsx") || is("xls") || type.includes("excel")) {
    return { text: extractXlsxText(bytes), format: "xlsx" };
  }
  if (type.includes("csv") || is("csv") || type.includes("text") || is("txt")) {
    return { text: extractPlainText(bytes), format: "text" };
  }
  return null;
}
