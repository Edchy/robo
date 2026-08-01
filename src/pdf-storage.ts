import type { Schedule } from './schedule';

const DATABASE_NAME = 'rosenbo-local-files';
const STORE_NAME = 'pdfs';
const PDF_KEY = 'current-schedule';
const DATABASE_VERSION = 1;

type StoredPdf = {
  blob: Blob;
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

  const stored: StoredPdf = {
    blob: file,
    name: file.name,
    lastModified: file.lastModified,
    expiresAt: new Date(schedule.year, schedule.month, 1).getTime(),
  };

  try {
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
    if (!stored?.blob || !stored.name || now.getTime() >= stored.expiresAt) {
      if (stored) await clearPdfFile();
      return null;
    }
    return new File([stored.blob], stored.name, {
      type: stored.blob.type || 'application/pdf',
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
