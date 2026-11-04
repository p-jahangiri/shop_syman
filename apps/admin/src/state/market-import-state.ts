export type MarketPreviewToken = Readonly<{ revision: number; csv: string }>;

// A preview belongs to one exact draft. File reads and edits invalidate it
// synchronously, before React renders disabled controls or an old read settles.
export class MarketImportDraft<T> {
  private revision = 0;
  private csv: string;
  private fileRead: number | null = null;
  private preview: { token: MarketPreviewToken; value: T } | null = null;
  constructor(csv = '') {
    this.csv = csv;
  }
  get readingFile() {
    return this.fileRead !== null;
  }
  replace(csv: string) {
    this.revision++;
    this.csv = csv;
    this.fileRead = null;
    this.preview = null;
  }
  beginFileRead() {
    this.preview = null;
    this.fileRead = ++this.revision;
    return this.fileRead;
  }
  finishFileRead(token: number, csv: string) {
    if (this.fileRead !== token || this.revision !== token) return false;
    this.replace(csv);
    return true;
  }
  cancelFileRead(token: number) {
    if (this.fileRead !== token) return false;
    this.invalidate();
    return true;
  }
  beginPreview(): MarketPreviewToken {
    if (this.readingFile) throw Error('ابتدا خواندن فایل انتخاب‌شده باید تمام شود.');
    return Object.freeze({ revision: this.revision, csv: this.csv });
  }
  acceptPreview(token: MarketPreviewToken, value: T) {
    if (this.readingFile || token.revision !== this.revision || token.csv !== this.csv)
      return false;
    this.preview = { token, value: structuredClone(value) };
    return true;
  }
  reviewed() {
    if (
      !this.preview ||
      this.readingFile ||
      this.preview.token.revision !== this.revision ||
      this.preview.token.csv !== this.csv
    )
      throw Error('متن فایل تغییر کرده است؛ پیش‌نمایش تازه بگیرید.');
    return { csv: this.preview.token.csv, preview: structuredClone(this.preview.value) };
  }
  invalidate() {
    this.revision++;
    this.fileRead = null;
    this.preview = null;
  }
}

// A later rejection cannot prove that an earlier request did not commit.
// Authentication/rate-limit/transport failures preserve the exact first command.
export function marketImportFailureIsUnknown(status: number | undefined, wasUncertain = false) {
  return (
    wasUncertain ||
    status === undefined ||
    status === 0 ||
    status >= 500 ||
    [401, 403, 408, 429].includes(status)
  );
}

export async function marketImportCsvHash(csv: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
