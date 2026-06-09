export interface QueuedTransaction {
  id: string; // reference or order UUID
  url: string; // edge function invocation url
  method: string; // e.g. "POST"
  body: string; // stringified body options
  headers: Record<string, string>;
  timestamp: number;
  retryCount: number;
  status: "pending" | "processing" | "success" | "failed";
  error?: string;
  network?: string;
  packageSize?: string;
  phone?: string;
  amount?: number;
}

const DB_NAME = "SwiftDataOfflineQueue";
const STORE_NAME = "queued_transactions";
const DB_VERSION = 1;

let isSyncing = false;

export function openQueueDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => {
      resolve((e.target as IDBOpenDBRequest).result);
    };
    request.onerror = (e) => {
      reject((e.target as IDBOpenDBRequest).error);
    };
  });
}

export async function queueTransaction(tx: Omit<QueuedTransaction, "timestamp" | "retryCount" | "status">): Promise<void> {
  try {
    const db = await openQueueDB();
    const newTx: QueuedTransaction = {
      ...tx,
      timestamp: Date.now(),
      retryCount: 0,
      status: "pending",
    };
    
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(newTx);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`[Offline Queue] Transaction ${tx.id} queued successfully.`);
    window.dispatchEvent(new CustomEvent("offline-queue-changed"));
    
    // Register PWA background sync
    await registerBackgroundSync();
  } catch (err) {
    console.error("[Offline Queue] Failed to queue transaction:", err);
    throw err;
  }
}

export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  try {
    const db = await openQueueDB();
    return await new Promise<QueuedTransaction[]>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("[Offline Queue] Failed to get queued transactions:", err);
    return [];
  }
}

export async function deleteQueuedTransaction(id: string): Promise<void> {
  try {
    const db = await openQueueDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    console.log(`[Offline Queue] Transaction ${id} deleted.`);
    window.dispatchEvent(new CustomEvent("offline-queue-changed"));
  } catch (err) {
    console.error("[Offline Queue] Failed to delete transaction:", err);
    throw err;
  }
}

async function updateTransactionStatusInDB(
  db: IDBDatabase,
  id: string,
  status: QueuedTransaction["status"],
  errorMsg?: string
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    
    getRequest.onsuccess = () => {
      const tx = getRequest.result as QueuedTransaction;
      if (tx) {
        tx.status = status;
        if (errorMsg !== undefined) tx.error = errorMsg;
        if (status === "pending") {
          tx.retryCount += 1;
        }
        const putRequest = store.put(tx);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve();
      }
    };
    
    getRequest.onerror = () => reject(getRequest.error);
  });
}

export async function syncOfflineQueue(): Promise<void> {
  if (isSyncing) return;
  // Prevent sync loops if browser has completely no internet access
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return;
  }
  
  isSyncing = true;
  window.dispatchEvent(new CustomEvent("offline-sync-status-changed", { detail: { isSyncing: true } }));
  
  try {
    const db = await openQueueDB();
    const txs = await getQueuedTransactions();
    const pending = txs.filter((t) => t.status === "pending" || t.status === "processing"); // retry processing status items too in case of page refresh crash
    
    if (pending.length === 0) {
      isSyncing = false;
      window.dispatchEvent(new CustomEvent("offline-sync-status-changed", { detail: { isSyncing: false } }));
      return;
    }
    
    console.log(`[Offline Client Sync] Syncing ${pending.length} pending transactions...`);
    
    for (const tx of pending) {
      try {
        await updateTransactionStatusInDB(db, tx.id, "processing");
        window.dispatchEvent(new CustomEvent("offline-queue-changed"));

        const res = await fetch(tx.url, {
          method: tx.method,
          headers: {
            "Content-Type": "application/json",
            ...tx.headers,
          },
          body: tx.body,
        });
        
        if (res.ok) {
          const resData = await res.json();
          if (resData && resData.error) {
            console.error(`[Offline Client Sync] API returned error for ${tx.id}:`, resData.error);
            await updateTransactionStatusInDB(db, tx.id, "failed", resData.error);
          } else {
            console.log(`[Offline Client Sync] Sync success for ${tx.id}`);
            await updateTransactionStatusInDB(db, tx.id, "success");
            // Dispatch sync complete notification to active pages
            window.dispatchEvent(new CustomEvent("offline-sync-complete", { detail: tx }));
          }
        } else {
          const errText = await res.text();
          console.error(`[Offline Client Sync] Sync HTTP error for ${tx.id}:`, res.status, errText);
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            await updateTransactionStatusInDB(db, tx.id, "failed", `HTTP ${res.status}: ${errText}`);
          } else {
            await updateTransactionStatusInDB(db, tx.id, "pending", `HTTP ${res.status}: ${errText}`);
          }
        }
      } catch (err: any) {
        console.error(`[Offline Client Sync] Failed fetch for ${tx.id}:`, err);
        await updateTransactionStatusInDB(db, tx.id, "pending", err.message || "Fetch failed");
      }
    }
  } catch (err) {
    console.error("[Offline Client Sync] Error during queue sync:", err);
  } finally {
    isSyncing = false;
    window.dispatchEvent(new CustomEvent("offline-sync-status-changed", { detail: { isSyncing: false } }));
    window.dispatchEvent(new CustomEvent("offline-queue-changed"));
  }
}

export async function registerBackgroundSync(): Promise<void> {
  if (typeof window !== "undefined" && "serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      // Use the standard sync registration tag
      const syncManager = (reg as any).sync;
      if (syncManager) {
        await syncManager.register("sync-transactions");
        console.log("[Offline Queue] Background sync tag 'sync-transactions' registered.");
      }
    } catch (err) {
      console.warn("[Offline Queue] Background sync registration failed:", err);
    }
  }
}
