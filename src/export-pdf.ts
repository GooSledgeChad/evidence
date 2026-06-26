import { resolve } from "path";
import { marked } from "marked";

const REPO_DIR = resolve(import.meta.dir, "..");
const postPath = resolve(REPO_DIR, "POST.md");
const outputHtml = resolve(REPO_DIR, "POST.html");
const outputPdf = resolve(REPO_DIR, "POST.pdf");

const markdown = await Bun.file(postPath).text();
const htmlBody = await marked(markdown);

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {
    margin: 2cm;
    size: A4;
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 100%;
    padding: 0;
    margin: 0;
  }
  h1 {
    font-size: 24px;
    margin-top: 20px;
    page-break-after: avoid;
    break-after: avoid;
  }
  h2 {
    font-size: 20px;
    margin-top: 28px;
    page-break-after: avoid;
    break-after: avoid;
  }
  h3 {
    font-size: 16px;
    margin-top: 20px;
    page-break-after: avoid;
    break-after: avoid;
  }
  p {
    margin: 8px 0;
    orphans: 3;
    widows: 3;
  }
  p:has(+ p > img) {
    page-break-after: avoid;
    break-after: avoid;
  }
  p > img {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  img {
    max-width: 85%;
    height: auto;
    display: block;
    margin: 12px auto;
    border: 1px solid #ddd;
    border-radius: 4px;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 8px 12px;
    text-align: left;
  }
  th {
    background: #f5f5f5;
    font-weight: bold;
  }
  strong {
    font-weight: 700;
  }
  ul {
    padding-left: 24px;
  }
  li {
    margin: 4px 0;
  }
  a {
    color: #0066cc;
  }
  blockquote {
    border-left: 3px solid #ddd;
    margin: 8px 0;
    padding: 4px 16px;
    color: #555;
  }
</style>
</head>
<body>
${htmlBody}
</body>
</html>`;

await Bun.write(outputHtml, html);
console.log(`Generated HTML: ${outputHtml}`);

const proc = Bun.spawn([
  "chromium",
  "--headless",
  "--disable-gpu",
  "--no-sandbox",
  "--print-to-pdf=" + outputPdf,
  "--no-pdf-header-footer",
  outputHtml,
], {
  cwd: REPO_DIR,
  stdout: "inherit",
  stderr: "inherit",
});

await proc.exited;
console.log(`Generated PDF: ${outputPdf}`);
