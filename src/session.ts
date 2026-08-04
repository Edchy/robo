/**
 * The two on-device stores, cleared as one.
 *
 * A month lives in two places: the parsed schedule in localStorage, the source
 * PDF in IndexedDB (see `storage.ts` and `pdf-storage.ts` for why they are
 * split). Nothing outside this file should clear one without the other — half a
 * teardown leaves a stale PDF offered against no calendar, or a calendar whose
 * "Se PDF" button silently reopens the file picker.
 *
 * There is deliberately only one way to erase a month, and it is the one the
 * user asks for by name. Swapping schedules does *not* clear anything up front:
 * the app keeps the current month until a replacement has actually parsed, and
 * `handleFile` then overwrites both stores. That way backing out of "Byt
 * schema" costs nothing, and a PDF that fails to parse cannot leave someone
 * with no schedule at all.
 */
/* Extensions are explicit here, unlike the rest of src: this module is imported
   directly by a node --test file, and Node's resolver has no extension guessing
   the way Vite does. */
import { forgetAll } from './storage.ts';
import { clearPdfFile } from './pdf-storage.ts';

/**
 * Remove everything this app has put on the device, initials included, so a
 * shared phone is left with nothing of this user.
 *
 * Async because IndexedDB is, and it resolves once the device is actually
 * clean. Callers that only need the UI to update can ignore the promise; the
 * stores clear either way.
 */
export async function forgetEverything(): Promise<void> {
  forgetAll();
  await clearPdfFile();
}
