import mammoth from "mammoth";

export async function extractResumeText(
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${fileName}`);
}
