import { BadRequestException, Injectable, Logger } from '@nestjs/common';

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

/** Magic-byte signatures — extension and client-supplied mime type are both untrusted. */
const SIGNATURES: Array<{ ext: string; test: (b: Buffer) => boolean }> = [
  { ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { ext: 'docx', test: (b) => b[0] === 0x50 && b[1] === 0x4b }, // zip container
];

@Injectable()
export class ContentService {
  private readonly log = new Logger('Content');

  async parse(file: { originalname: string; buffer: Buffer; mimetype: string; size: number }): Promise<{
    text: string;
    sourceName: string;
    kind: string;
  }> {
    if (!file?.buffer?.length) throw new BadRequestException('The uploaded file is empty.');
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`File is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
    }

    const name = this.safeName(file.originalname);
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const sig = SIGNATURES.find((s) => s.test(file.buffer))?.ext;

    if (ext === 'pdf' || sig === 'pdf') return { text: await this.pdf(file.buffer), sourceName: name, kind: 'pdf' };
    if (ext === 'docx' || (sig === 'docx' && ext !== 'txt')) {
      return { text: await this.docx(file.buffer), sourceName: name, kind: 'docx' };
    }
    if (['txt', 'md', 'csv', 'json'].includes(ext)) {
      return { text: file.buffer.toString('utf8'), sourceName: name, kind: 'text' };
    }

    throw new BadRequestException('Unsupported file type. Upload a PDF, DOCX, TXT or MD file.');
  }

  private safeName(n: string): string {
    return (n || 'upload')
      .replace(/[\\/]/g, '_')
      .replace(/[^\w.\- ()]/g, '')
      .slice(0, 80) || 'upload';
  }

  private async pdf(buf: Buffer): Promise<string> {
    try {
      // Import the library entry point directly: the package index runs a debug
      // harness that reads a test fixture off disk and throws in production.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const out = await pdfParse(buf, { max: 60 });
      const text = String(out?.text ?? '').trim();
      if (text.length < 40) {
        throw new BadRequestException(
          'That PDF has almost no extractable text — it is probably a scan. Paste the text instead, or upload a text-based PDF.',
        );
      }
      return text;
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      this.log.warn(`pdf parse failed: ${e?.message}`);
      throw new BadRequestException('Could not read that PDF. Try a different file or paste the text.');
    }
  }

  private async docx(buf: Buffer): Promise<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mammoth = require('mammoth');
      const out = await mammoth.extractRawText({ buffer: buf });
      const text = String(out?.value ?? '').trim();
      if (!text) throw new Error('empty');
      return text;
    } catch (e: any) {
      this.log.warn(`docx parse failed: ${e?.message}`);
      throw new BadRequestException('Could not read that Word file. Try exporting it as PDF or plain text.');
    }
  }
}
