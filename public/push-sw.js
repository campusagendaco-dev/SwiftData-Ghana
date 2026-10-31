// SwiftData Ghana Background Service Worker Extensions
// Listens for push notification payloads from Deno/Supabase backend even when the tab is closed.

const SWIFTDATA_VAPID_PUBLIC_KEY =
  'BBunKshlnxwoqC83k7a01ApJwKgZ0L-QqEySWnz0EuJL1eS7lneeiKemLOQ9Z7DYD82KptTcbYjeQKaDNN1o5gM';

function urlBase64ToUint8ArraySw(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  console.log('[Push Worker] Background Push Received.');
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (err) {
      console.warn('[Push Worker] Payload received as raw text:', err);
      data = {
        title: 'SwiftData Alert',
        body: event.data.text() || 'You have a new update from SwiftData.'
      };
    }
  }

  const title = data.title || 'SwiftData Ghana';
  const tag = data.tag || (data.id ? `swiftdata-order-${data.id}` : `swiftdata-alert-${Date.now()}`);
  const rawIcon = data.icon && data.icon !== '/pwa-192x192.png' ? data.icon : '/logo.png';
  
  const options = {
    body: data.body || 'You have a new transaction update.',
    icon: rawIcon,
    badge: '/logo.png',
    tag: tag,
    renotify: true,
    vibrate: [250, 100, 250, 100, 250],
    data: {
      url: data.url || '/dashboard',
      id: data.id,
      timestamp: Date.now()
    }
  };

  try {
    if (data.requireInteraction !== undefined) {
      options.requireInteraction = Boolean(data.requireInteraction);
    }
  } catch (_) {}

  try {
    if (typeof Notification !== 'undefined' && 'actions' in Notification.prototype) {
      options.actions = [
        { action: 'open', title: 'View Details 🚀' },
        { action: 'close', title: 'Dismiss' }
      ];
    }
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(title, options).catch(function(err) {
      console.warn('[Push Worker] Full showNotification failed, retrying with minimal options:', err);
      return self.registration.showNotification(title, {
        body: data.body || 'You have a new transaction update.',
        icon: '/logo.png'
      });
    })
  );
});

self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[Push Worker] Push subscription rotated by browser — re-subscribing...');
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8ArraySw(SWIFTDATA_VAPID_PUBLIC_KEY)
    }).then(async function(newSub) {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({
          type: 'PUSH_SUBSCRIPTION_CHANGED',
          endpoint: newSub.endpoint
        });
      }
    }).catch(function(err) {
      console.warn('[Push Worker] pushsubscriptionchange re-subscribe failed:', err);
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Push Worker] Notification Clicked. Action:', event.action);
  
  try {
    event.notification.close();
  } catch (_) {}

  // If user clicked the explicit 'close' action button, do not navigate
  if (event.action === 'close') {
    return;
  }

  const targetUrl = event.notification?.data?.url || '/dashboard';
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  // Focus an existing client window if open, or open a fresh one
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async function(clientList) {
      for (const client of clientList) {
        if (client.url && client.url.startsWith(self.location.origin) && 'focus' in client) {
          try {
            client.postMessage({ type: 'NAVIGATE', url: targetUrl });
            if ('navigate' in client && client.url !== fullTargetUrl) {
              await client.navigate(fullTargetUrl).catch(() => {});
            }
            return await client.focus();
          } catch (_) {}
        }
      }
      if (clients.openWindow) {
        return await clients.openWindow(fullTargetUrl).catch(() => {});
      }
    }).catch(function(err) {
      console.error('[Push Worker] notificationclick error:', err);
    })
  );
});

// ─── Offline Transaction Queue & Background Sync ───

const DB_NAME = 'SwiftDataOfflineQueue';
const STORE_NAME = 'queued_transactions';
const DB_VERSION = 1;

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = function(e) {
      resolve(e.target.result);
    };
    request.onerror = function(e) {
      reject(e.target.error);
    };
  });
}

function getPendingTransactions(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = function() {
      const all = request.result || [];
      const pending = all.filter(tx => tx.status === 'pending' || tx.status === 'processing');
      resolve(pending);
    };
    request.onerror = function() {
      reject(request.error);
    };
  });
}

function updateTransactionStatus(db, id, status, errorMsg = null) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getRequest = store.get(id);
    getRequest.onsuccess = function() {
      const tx = getRequest.result;
      if (tx) {
        tx.status = status;
        if (errorMsg !== null) tx.error = errorMsg;
        if (status === 'pending') {
          tx.retryCount = (tx.retryCount || 0) + 1;
        }
        const putRequest = store.put(tx);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve();
      }
    };
    getRequest.onerror = function() {
      reject(getRequest.error);
    };
  });
}

async function notifyClientsOfSuccess(tx) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    client.postMessage({
      type: 'OFFLINE_TRANSACTION_SYNCED',
      id: tx.id,
      network: tx.network,
      packageSize: tx.packageSize,
      phone: tx.phone,
      amount: tx.amount
    });
  }
}

async function syncTransactions() {
  console.log('[Push SW] Starting offline transaction synchronization...');
  try {
    const db = await openQueueDB();
    const pending = await getPendingTransactions(db);
    console.log(`[Push SW] Found ${pending.length} pending transactions to sync.`);
    
    for (const tx of pending) {
      try {
        await updateTransactionStatus(db, tx.id, 'processing');
        
        console.log(`[Push SW] Replaying fetch for transaction ${tx.id} to ${tx.url}`);
        const response = await fetch(tx.url, {
          method: tx.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...tx.headers
          },
          body: tx.body
        });
        
        if (response.ok) {
          const resData = await response.json();
          if (resData && resData.error) {
            console.error(`[Push SW] Transaction API error for ${tx.id}:`, resData.error);
            await updateTransactionStatus(db, tx.id, 'failed', resData.error);
          } else {
            console.log(`[Push SW] Transaction sync success for ${tx.id}`);
            await updateTransactionStatus(db, tx.id, 'success');
            await notifyClientsOfSuccess(tx);
          }
        } else {
          const errText = await response.text();
          console.error(`[Push SW] Transaction HTTP error for ${tx.id}:`, response.status, errText);
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            await updateTransactionStatus(db, tx.id, 'failed', `HTTP ${response.status}: ${errText}`);
          } else {
            await updateTransactionStatus(db, tx.id, 'pending', `HTTP ${response.status}: ${errText}`);
          }
        }
      } catch (err) {
        console.error(`[Push SW] Fetch failed for transaction ${tx.id}:`, err);
        await updateTransactionStatus(db, tx.id, 'pending', err.message || 'Fetch failed');
      }
    }
  } catch (dbErr) {
    console.error('[Push SW] IndexedDB database access failed during sync:', dbErr);
  }
}

self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-transactions') {
    console.log('[Push SW] Sync event fired for tag: sync-transactions');
    event.waitUntil(syncTransactions());
  }
});
