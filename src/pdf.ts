import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseSchedule, ScheduleError, type Schedule, type TextItem } from './schedule';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 20;

/** Read a schedule PDF entirely in the browser — nothing is uploaded. */
export async function readSchedulePdf(file: File): Promise<Schedule> {
  if (file.size === 0) {
    throw new ScheduleError('Filen är tom. Välj schema-PDF:en igen.');
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new ScheduleError(
      'PDF-filen är större än 25 MB. Kontrollera att du valde rätt fil.'
    );
  }

  let doc;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (cause) {
    // The message below blames the file, but this catch also fires for causes
    // that have nothing to do with it — most often the worker failing to load,
    // which happens to a tab left open across a rebuild because the chunk it
    // remembers no longer exists. That looked exactly like a corrupt PDF and
    // cost a real debugging session. pdf.js's own error goes to the console so
    // the next occurrence can be told apart at a glance.
    console.error('[rosenbo] kunde inte öppna PDF:en', cause);
    throw new ScheduleError('Kunde inte öppna filen. Är det en giltig PDF?');
  }

  if (doc.numPages > MAX_PDF_PAGES) {
    await doc.destroy();
    throw new ScheduleError(
      'PDF-filen har fler än 20 sidor. Kontrollera att du valde månadens schema.'
    );
  }

  const items: TextItem[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        const it = item as { str?: string; transform?: number[] };
        if (!it.str || !it.str.trim() || !it.transform) continue;
        items.push({ x: it.transform[4], y: it.transform[5], s: it.str });
      }
    }
  } finally {
    await doc.destroy();
  }

  if (items.length === 0) {
    throw new ScheduleError(
      'PDF:en innehåller ingen text — den verkar vara inskannad som bild. Be om originalfilen.'
    );
  }

  return parseSchedule(items);
}
