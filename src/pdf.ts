import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseSchedule, ScheduleError, type Schedule, type TextItem } from './schedule';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Read a schedule PDF entirely in the browser — nothing is uploaded. */
export async function readSchedulePdf(file: File): Promise<Schedule> {
  let doc;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    doc = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new ScheduleError('Kunde inte öppna filen. Är det en giltig PDF?');
  }

  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[] };
      if (!it.str || !it.str.trim() || !it.transform) continue;
      items.push({ x: it.transform[4], y: it.transform[5], s: it.str });
    }
  }

  if (items.length === 0) {
    throw new ScheduleError(
      'PDF:en innehåller ingen text — den verkar vara inskannad som bild. Be om originalfilen.'
    );
  }

  return parseSchedule(items);
}
