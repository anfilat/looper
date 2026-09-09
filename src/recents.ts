/**
 * "Recent files" storage.
 *
 * The display list (video names, max 5, newest first) lives in localStorage.
 * The FileSystemFileHandles needed to re-open the files cannot be serialized
 * to JSON, so they live in IndexedDB, keyed by the same id.
 */

const RECENTS_KEY = "looper:recents";
const DB_NAME = "looper-recents";
const DB_VERSION = 1;
const STORE_NAME = "handles";

export const MAX_RECENTS = 5;

export interface RecentEntry {
  id: string;
  videoName: string;
  addedAt: number;
}

export interface RecentHandles {
  video: FileSystemFileHandle;
  subtitle: FileSystemFileHandle;
}

export function isFsAccessSupported(): boolean {
  return typeof window.showOpenFilePicker === "function";
}

export function recentId(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentEntry =>
        !!item &&
        typeof item === "object" &&
        typeof (item as RecentEntry).id === "string" &&
        typeof (item as RecentEntry).videoName === "string" &&
        typeof (item as RecentEntry).addedAt === "number"
    );
  } catch {
    return [];
  }
}

function saveRecents(entries: RecentEntry[]): void {
  localStorage.setItem(RECENTS_KEY, JSON.stringify(entries));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = action(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

interface StoredHandles {
  video: FileSystemFileHandle;
  subtitle: FileSystemFileHandle;
}

export async function getRecentHandles(id: string): Promise<RecentHandles | null> {
  try {
    const stored = await runRequest<StoredHandles | undefined>("readonly", (store) =>
      store.get(id) as IDBRequest<StoredHandles | undefined>
    );
    if (stored?.video && stored.subtitle) return stored;
    return null;
  } catch {
    return null;
  }
}

async function deleteHandles(id: string): Promise<void> {
  try {
    await runRequest("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
  } catch {
    // Best effort: an orphaned IndexedDB record is harmless.
  }
}

/**
 * Remember a freshly opened pair of files: put the handles into IndexedDB,
 * move the entry to the top of the list, cap at MAX_RECENTS.
 */
export async function addRecent(videoFile: File, handles: RecentHandles): Promise<void> {
  const id = recentId(videoFile);
  await runRequest("readwrite", (store) => store.put(handles, id) as IDBRequest<IDBValidKey>);

  const entries = loadRecents().filter((entry) => entry.id !== id);
  entries.unshift({ id, videoName: videoFile.name, addedAt: Date.now() });
  saveRecents(entries.slice(0, MAX_RECENTS));

  const evicted = entries.slice(MAX_RECENTS);
  for (const entry of evicted) {
    await deleteHandles(entry.id);
  }
}

/** Update the display name and move the entry to the top after a successful re-open. */
export async function touchRecent(id: string, videoName: string): Promise<void> {
  const entries = loadRecents();
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  entries[index] = { id, videoName, addedAt: Date.now() };
  entries.sort((a, b) => b.addedAt - a.addedAt);
  saveRecents(entries);
}

export async function removeRecent(id: string): Promise<void> {
  saveRecents(loadRecents().filter((entry) => entry.id !== id));
  await deleteHandles(id);
}
