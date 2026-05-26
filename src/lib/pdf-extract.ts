// Extração de texto do PDF no navegador via pdfjs-dist
export async function extractPdfText(file: File): Promise<{ text: string; numPages: number }> {
  const pdfjs: any = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = (worker as any).default;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it: any) => it.str).join(" ");
    text += `\n\n=== Slide ${i} ===\n${pageText}`;
  }
  return { text, numPages: doc.numPages };
}
