// word-extractor ships no bundled types and there's no @types package —
// minimal ambient declaration covering the only method HireView uses
// (extractResumeText's .doc branch). See morungos/node-word-extractor.
declare module "word-extractor" {
  interface WordDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getFooters(): string;
    getAnnotations(): string;
    getTextboxes(options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string;
  }

  export default class WordExtractor {
    extract(input: string | Buffer): Promise<WordDocument>;
  }
}
