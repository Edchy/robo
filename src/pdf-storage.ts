import type { Schedule } from './schedule';
/* Explicit extension: this module is reachable from a node --test file via
   session.ts, and Node's resolver does not guess extensions. */
import { expiryOf } from './storage.ts';

const DATABASE_NAME = 'rosenbo-local-files';
const STORE_NAME = 'pdfs';
const PDF_KEY = 'current-schedule';
const DATABASE_VERSION = 1;

/**
 * The PDF is kept as raw bytes rather than as the `File` the picker handed us.
 *
 * A `File` from an <input> is a handle onto something on disk, and IndexedDB is
 * allowed to persist it as that handle. It survives a reload looking perfectly
 * intact — right name, right size — and only fails when something finally reads
 * it, by which point the schedule is on screen and "Se PDF" is the thing that
 * breaks. On iOS, where the picker copies into a sandbox the OS later reclaims,
 * this is the normal outcome rather than the edge case.
 *
 * An ArrayBuffer has no such backing. Once it is in the store the bytes are
 * ours, and the File is rebuilt from them on the way out.
 */
type StoredPdf = {
  bytes: ArrayBuffer;
  type: string;
  name: string;
  lastModified: number;
  expiresAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

/** Keep the source PDF on this device until its schedule month has ended. */
export async function savePdfFile(file: File, schedule: Schedule): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  try {
    // Read the bytes out before the store sees them, so what lands in IndexedDB
    // is a copy we own rather than a pointer at the user's filesystem.
    const stored: StoredPdf = {
      bytes: await file.arrayBuffer(),
      type: file.type || 'application/pdf',
      name: file.name,
      lastModified: file.lastModified,
      // The same rule the parsed schedule expires on, so the two stores can
      // never disagree about which month is current.
      expiresAt: expiryOf(schedule).getTime(),
    };
    await withStore('readwrite', (store) => store.put(stored, PDF_KEY));
  } catch {
    // The viewer still works for this open tab. Persistence is a convenience.
  }
}

export async function loadPdfFile(now: Date = new Date()): Promise<File | null> {
  if (typeof indexedDB === 'undefined') return null;

  try {
    const stored = await withStore<StoredPdf | undefined>(
      'readonly',
      (store) => store.get(PDF_KEY)
    );
    // `byteLength` rather than a plain truthiness test: a zero-length buffer is
    // a write that went wrong, and handing it back would fail later in the
    // viewer instead of here, where we can still ask for the file again.
    if (!stored?.bytes?.byteLength || !stored.name || now.getTime() >= stored.expiresAt) {
      if (stored) await clearPdfFile();
      return null;
    }
    return new File([stored.bytes], stored.name, {
      type: stored.type || 'application/pdf',
      lastModified: stored.lastModified,
    });
  } catch {
    return null;
  }
}

export async function clearPdfFile(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await withStore('readwrite', (store) => store.delete(PDF_KEY));
  } catch {
    // Storage may be unavailable or already gone.
  }
}
