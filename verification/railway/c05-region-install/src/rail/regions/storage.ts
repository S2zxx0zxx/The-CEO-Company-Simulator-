import {
  decodeBase64ToBytes,
  decodeInstalledRegionRegistry,
  encodeBytesToBase64,
  type InstalledRegionRegistry,
  type StorageQuotaReport,
} from './contracts';

export interface RegionStorageBroadcastEvent {
  readonly type: 'REGISTRY_UPDATED' | 'INSTALL_FAILED' | 'ROLLBACK_EXECUTED' | 'VERSION_REMOVED';
  readonly regionId: string;
  readonly revision: number;
  readonly activeVersionKey: string | null;
  readonly timestampUtc: string;
}

export class StorageQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageQuotaExceededError';
  }
}

export class ConcurrentRegistryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrentRegistryConflictError';
  }
}

export class FaultInjectedAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultInjectedAbortError';
  }
}

export function validateStorageObjectKey(key: string): string {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > 240 ||
    key.includes('..') ||
    key.startsWith('/') ||
    key.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(key) ||
    !/^[A-Za-z0-9._/@+:=-]+$/.test(key)
  ) {
    throw new TypeError(`Invalid region storage key: ${String(key)}`);
  }
  return key;
}

export interface RegionStorageBackend {
  readonly backendName: string;
  readonly storageNamespace: string;
  readonly physicalDeviceVerified: boolean;
  readonly activeBinaryStoreMode: 'opfs' | 'indexeddb' | 'memory' | 'capacitor-chunked-fs';

  checkStorageQuota(): Promise<StorageQuotaReport>;
  readState(): Promise<InstalledRegionRegistry | null>;
  compareAndSwapState(expectedRevision: number | null, nextState: InstalledRegionRegistry): Promise<boolean>;

  writeStagingAsset(stagingKey: string, data: Uint8Array): Promise<void>;
  readStagingAsset(stagingKey: string): Promise<Uint8Array | null>;
  deleteStagingAsset(stagingKey: string): Promise<void>;
  listStagingKeys(): Promise<string[]>;

  promoteStagedAsset(stagingKey: string, committedKey: string): Promise<void>;
  readCommittedRange(committedKey: string, offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer>;
  readCommittedAll(committedKey: string): Promise<Uint8Array>;
  committedStat(committedKey: string): Promise<{ readonly exists: boolean; readonly byteLength: number }>;
  deleteCommittedAsset(committedKey: string): Promise<void>;
  listCommittedKeys(): Promise<string[]>;

  withExclusiveLock<T>(lockName: string, fn: () => Promise<T>): Promise<T>;
  broadcastEvent(ev: RegionStorageBroadcastEvent): void;
  subscribeEvents(listener: (ev: RegionStorageBroadcastEvent) => void): () => void;
  close(): Promise<void>;
}

export interface MemoryStorageFaultHooks {
  onBeforeStageWrite?: (stagingKey: string, bytes: Uint8Array) => void;
  onBeforePromote?: (stagingKey: string, committedKey: string) => void;
  onBeforeCasState?: (expectedRevision: number | null, nextState: InstalledRegionRegistry) => void;
  onBeforeCommittedRead?: (committedKey: string, offset: number, length: number) => void;
}

/** Deterministic in-memory storage backend with exact quota enforcement & fault injection for tests. */
export class MemoryRegionStorageBackend implements RegionStorageBackend {
  readonly backendName = 'memory-region-storage';
  readonly storageNamespace: string;
  readonly physicalDeviceVerified = false;
  readonly activeBinaryStoreMode = 'memory' as const;

  #quotaStatus: StorageQuotaReport['quotaStatus'];
  #totalQuotaBytes: number | null;
  #persistentGranted: boolean | null;
  #state: InstalledRegionRegistry | null = null;
  readonly #staging = new Map<string, Uint8Array>();
  readonly #committed = new Map<string, Uint8Array>();
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #listeners = new Set<(ev: RegionStorageBroadcastEvent) => void>();
  #hooks: MemoryStorageFaultHooks;

  constructor(options: {
    namespace?: string;
    totalQuotaBytes?: number | null;
    quotaStatus?: StorageQuotaReport['quotaStatus'];
    persistentGranted?: boolean | null;
    faultHooks?: MemoryStorageFaultHooks;
  } = {}) {
    this.storageNamespace = options.namespace ?? 'railway-ceo-regions-v1';
    this.#quotaStatus = options.quotaStatus ?? 'KNOWN';
    this.#totalQuotaBytes = options.totalQuotaBytes === undefined ? 512 * 1024 * 1024 : options.totalQuotaBytes;
    this.#persistentGranted = options.persistentGranted ?? true;
    this.#hooks = { ...(options.faultHooks ?? {}) };
  }

  setFaultHooks(hooks: MemoryStorageFaultHooks): void {
    this.#hooks = { ...hooks };
  }

  setSimulatedQuota(totalQuotaBytes: number | null, quotaStatus: StorageQuotaReport['quotaStatus'] = 'KNOWN'): void {
    this.#totalQuotaBytes = totalQuotaBytes;
    this.#quotaStatus = quotaStatus;
  }

  /** Fault injection helper simulating external eviction, truncation, or bit-flip corruption. */
  injectCommittedCorruption(committedKey: string, mode: 'delete' | 'truncate' | 'flip_byte'): void {
    const key = validateStorageObjectKey(committedKey);
    const existing = this.#committed.get(key);
    if (mode === 'delete' || !existing) {
      this.#committed.delete(key);
      return;
    }
    if (mode === 'truncate') {
      this.#committed.set(key, existing.slice(0, Math.max(0, Math.floor(existing.byteLength / 2))));
      return;
    }
    const copy = existing.slice();
    if (copy.byteLength > 0) {
      const idx = Math.min(copy.byteLength - 1, 16);
      copy[idx] = copy[idx] ^ 0xff;
    }
    this.#committed.set(key, copy);
  }

  #totalStoredBytes(): number {
    let total = this.#state ? new TextEncoder().encode(JSON.stringify(this.#state)).byteLength : 0;
    for (const v of this.#staging.values()) total += v.byteLength;
    for (const v of this.#committed.values()) total += v.byteLength;
    return total;
  }

  async checkStorageQuota(): Promise<StorageQuotaReport> {
    const used = this.#totalStoredBytes();
    if (this.#quotaStatus !== 'KNOWN' || this.#totalQuotaBytes === null) {
      return {
        backendName: this.backendName,
        quotaStatus: this.#quotaStatus,
        totalQuotaBytes: null,
        usedBytes: used,
        availableBytes: null,
        persistentStorageGranted: this.#persistentGranted,
      };
    }
    return {
      backendName: this.backendName,
      quotaStatus: 'KNOWN',
      totalQuotaBytes: this.#totalQuotaBytes,
      usedBytes: used,
      availableBytes: Math.max(0, this.#totalQuotaBytes - used),
      persistentStorageGranted: this.#persistentGranted,
    };
  }

  async readState(): Promise<InstalledRegionRegistry | null> {
    return this.#state ? decodeInstalledRegionRegistry(structuredClone(this.#state)) : null;
  }

  async compareAndSwapState(expectedRevision: number | null, nextState: InstalledRegionRegistry): Promise<boolean> {
    const validated = decodeInstalledRegionRegistry(structuredClone(nextState));
    this.#hooks.onBeforeCasState?.(expectedRevision, validated);
    const currentRev = this.#state ? this.#state.revision : null;
    if (currentRev !== expectedRevision) {
      return false;
    }
    this.#state = validated;
    return true;
  }

  async writeStagingAsset(stagingKey: string, data: Uint8Array): Promise<void> {
    const key = validateStorageObjectKey(stagingKey);
    const copy = new Uint8Array(data);
    this.#hooks.onBeforeStageWrite?.(key, copy);
    const existingBytes = this.#staging.get(key)?.byteLength ?? 0;
    const projectedUsed = this.#totalStoredBytes() - existingBytes + copy.byteLength;
    if (this.#quotaStatus === 'KNOWN' && this.#totalQuotaBytes !== null && projectedUsed > this.#totalQuotaBytes) {
      throw new StorageQuotaExceededError(`Simulated quota exceeded staging ${key}: ${projectedUsed} > ${this.#totalQuotaBytes}`);
    }
    this.#staging.set(key, copy);
  }

  async readStagingAsset(stagingKey: string): Promise<Uint8Array | null> {
    const key = validateStorageObjectKey(stagingKey);
    const hit = this.#staging.get(key);
    return hit ? new Uint8Array(hit) : null;
  }

  async deleteStagingAsset(stagingKey: string): Promise<void> {
    const key = validateStorageObjectKey(stagingKey);
    this.#staging.delete(key);
  }

  async listStagingKeys(): Promise<string[]> {
    return [...this.#staging.keys()].sort();
  }

  async promoteStagedAsset(stagingKey: string, committedKey: string): Promise<void> {
    const sKey = validateStorageObjectKey(stagingKey);
    const cKey = validateStorageObjectKey(committedKey);
    this.#hooks.onBeforePromote?.(sKey, cKey);
    const data = this.#staging.get(sKey);
    if (!data) {
      throw new Error(`Missing staged asset for promotion: ${sKey}`);
    }
    this.#committed.set(cKey, new Uint8Array(data));
    this.#staging.delete(sKey);
  }

  async readCommittedRange(committedKey: string, offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset + length)) {
      throw new RangeError(`Invalid range read bounds: offset=${offset}, length=${length}`);
    }
    const key = validateStorageObjectKey(committedKey);
    this.#hooks.onBeforeCommittedRead?.(key, offset, length);
    const data = this.#committed.get(key);
    if (!data) {
      throw new Error(`MISSING_COMMITTED_ASSET: ${key}`);
    }
    if (offset > data.byteLength) {
      throw new RangeError(`Range offset ${offset} exceeds asset length ${data.byteLength}`);
    }
    const end = Math.min(data.byteLength, offset + length);
    const slice = data.subarray(offset, end);
    return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer;
  }

  async readCommittedAll(committedKey: string): Promise<Uint8Array> {
    const key = validateStorageObjectKey(committedKey);
    const data = this.#committed.get(key);
    if (!data) {
      throw new Error(`MISSING_COMMITTED_ASSET: ${key}`);
    }
    return new Uint8Array(data);
  }

  async committedStat(committedKey: string): Promise<{ readonly exists: boolean; readonly byteLength: number }> {
    const key = validateStorageObjectKey(committedKey);
    const data = this.#committed.get(key);
    return data ? { exists: true, byteLength: data.byteLength } : { exists: false, byteLength: 0 };
  }

  async deleteCommittedAsset(committedKey: string): Promise<void> {
    const key = validateStorageObjectKey(committedKey);
    this.#committed.delete(key);
  }

  async listCommittedKeys(): Promise<string[]> {
    return [...this.#committed.keys()].sort();
  }

  async withExclusiveLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.#locks.get(lockName) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((res) => {
      release = res;
    });
    const tail = prior.then(() => current, () => current);
    this.#locks.set(lockName, tail);
    await prior.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.#locks.get(lockName) === tail) {
        this.#locks.delete(lockName);
      }
    }
  }

  broadcastEvent(ev: RegionStorageBroadcastEvent): void {
    for (const listener of this.#listeners) {
      listener(ev);
    }
  }

  subscribeEvents(listener: (ev: RegionStorageBroadcastEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.#listeners.clear();
  }
}

interface IdRegistryWrapper {
  readonly id: 'registry';
  readonly data: InstalledRegionRegistry;
}

interface BlobRecord {
  readonly key: string;
  readonly bytes: Uint8Array;
}

function keyToSafeSegments(storageKey: string): string[] {
  const safe = validateStorageObjectKey(storageKey);
  return safe.split('/').map((seg) => seg.replace(/[^A-Za-z0-9._-]/g, '_'));
}

async function resolveOpfsSubFile(
  root: FileSystemDirectoryHandle,
  subdir: 'staging' | 'committed',
  storageKey: string,
  create: boolean,
): Promise<FileSystemFileHandle | null> {
  try {
    let dir = await root.getDirectoryHandle(subdir, { create });
    const parts = keyToSafeSegments(storageKey);
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create });
    }
    return await dir.getFileHandle(parts[parts.length - 1], { create });
  } catch (err) {
    if (!create && err instanceof DOMException && err.name === 'NotFoundError') {
      return null;
    }
    throw err;
  }
}

async function deleteOpfsSubFile(root: FileSystemDirectoryHandle, subdir: 'staging' | 'committed', storageKey: string): Promise<void> {
  try {
    let dir = await root.getDirectoryHandle(subdir, { create: false });
    const parts = keyToSafeSegments(storageKey);
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: false });
    }
    await dir.removeEntry(parts[parts.length - 1]);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return;
    }
    throw err;
  }
}

async function listOpfsRecursive(dir: FileSystemDirectoryHandle, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  const entriesFn = (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries;
  for await (const [name, handle] of entriesFn.call(dir)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'file') {
      out.push(rel);
    } else if (handle.kind === 'directory') {
      out.push(...(await listOpfsRecursive(handle as FileSystemDirectoryHandle, rel)));
    }
  }
  return out.sort();
}

/**
 * Genuine Web/PWA durable storage backend using dedicated IndexedDB ('railway-ceo-regions-v1')
 * for atomic registry + recovery journal CAS, OPFS for streamed/ranged binary storage
 * (with IndexedDB fallback), navigator.locks for exclusive install locks, and BroadcastChannel.
 * Completely separate from Dexie gameplay DB 'railway-ceo-save-v1'.
 */
export class IndexedDbOpfsRegionBackend implements RegionStorageBackend {
  readonly backendName = 'indexeddb-opfs-region-storage';
  readonly storageNamespace: string;
  readonly physicalDeviceVerified = false;
  #binaryMode: 'opfs' | 'indexeddb' = 'indexeddb';
  #dbPromise: Promise<IDBDatabase> | null = null;
  #opfsRootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;
  #channel: BroadcastChannel | null = null;
  readonly #localListeners = new Set<(ev: RegionStorageBroadcastEvent) => void>();
  readonly #localLocks = new Map<string, Promise<unknown>>();
  readonly #preferOpfs: boolean;

  constructor(options: { dbName?: string; preferOpfs?: boolean } = {}) {
    this.storageNamespace = options.dbName ?? 'railway-ceo-regions-v1';
    if (this.storageNamespace === 'railway-ceo-save-v1') {
      throw new Error('C05 isolation invariant: region storage must NEVER reuse railway-ceo-save-v1');
    }
    this.#preferOpfs = options.preferOpfs ?? true;
    if (typeof BroadcastChannel !== 'undefined') {
      this.#channel = new BroadcastChannel(this.storageNamespace + ':events');
      this.#channel.onmessage = (msg) => {
        if (msg?.data) {
          for (const listener of this.#localListeners) {
            listener(msg.data as RegionStorageBroadcastEvent);
          }
        }
      };
    }
  }

  get activeBinaryStoreMode(): 'opfs' | 'indexeddb' {
    return this.#binaryMode;
  }

  async #openDb(): Promise<IDBDatabase> {
    if (!this.#dbPromise) {
      if (typeof indexedDB === 'undefined') {
        throw new Error('IndexedDB unavailable in current runtime');
      }
      this.#dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(this.storageNamespace, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('state')) {
            db.createObjectStore('state', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('staging_blobs')) {
            db.createObjectStore('staging_blobs', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('committed_blobs')) {
            db.createObjectStore('committed_blobs', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('key_map')) {
            db.createObjectStore('key_map', { keyPath: 'safePath' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Failed to open region IndexedDB'));
      });
    }
    return this.#dbPromise;
  }

  async #getOpfsRoot(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.#preferOpfs) {
      this.#binaryMode = 'indexeddb';
      return null;
    }
    if (!this.#opfsRootPromise) {
      this.#opfsRootPromise = (async () => {
        try {
          if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
            this.#binaryMode = 'indexeddb';
            return null;
          }
          const top = await navigator.storage.getDirectory();
          const root = await top.getDirectoryHandle(this.storageNamespace, { create: true });
          this.#binaryMode = 'opfs';
          return root;
        } catch {
          this.#binaryMode = 'indexeddb';
          return null;
        }
      })();
    }
    return this.#opfsRootPromise;
  }

  async checkStorageQuota(): Promise<StorageQuotaReport> {
    await this.#getOpfsRoot();
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return {
        backendName: this.backendName,
        quotaStatus: 'UNSUPPORTED',
        totalQuotaBytes: null,
        usedBytes: null,
        availableBytes: null,
        persistentStorageGranted: null,
      };
    }
    let persisted: boolean | null = null;
    try {
      if (navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
    } catch {
      persisted = null;
    }
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.quota !== 'number' || !Number.isFinite(est.quota) || typeof est.usage !== 'number' || !Number.isFinite(est.usage)) {
        return {
          backendName: this.backendName,
          quotaStatus: 'UNKNOWN',
          totalQuotaBytes: null,
          usedBytes: typeof est.usage === 'number' && Number.isFinite(est.usage) ? est.usage : null,
          availableBytes: null,
          persistentStorageGranted: persisted,
        };
      }
      return {
        backendName: this.backendName,
        quotaStatus: 'KNOWN',
        totalQuotaBytes: est.quota,
        usedBytes: est.usage,
        availableBytes: Math.max(0, est.quota - est.usage),
        persistentStorageGranted: persisted,
      };
    } catch {
      return {
        backendName: this.backendName,
        quotaStatus: 'UNKNOWN',
        totalQuotaBytes: null,
        usedBytes: null,
        availableBytes: null,
        persistentStorageGranted: persisted,
      };
    }
  }

  async readState(): Promise<InstalledRegionRegistry | null> {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['state'], 'readonly');
      const store = tx.objectStore('state');
      const req = store.get('registry');
      req.onsuccess = () => {
        const rec = req.result as IdRegistryWrapper | undefined;
        resolve(rec ? decodeInstalledRegionRegistry(rec.data) : null);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to read region registry state'));
    });
  }

  async compareAndSwapState(expectedRevision: number | null, nextState: InstalledRegionRegistry): Promise<boolean> {
    const validated = decodeInstalledRegionRegistry(structuredClone(nextState));
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['state'], 'readwrite');
      const store = tx.objectStore('state');
      const getReq = store.get('registry');
      let swapped = false;
      getReq.onsuccess = () => {
        const cur = getReq.result as IdRegistryWrapper | undefined;
        const curRev = cur ? cur.data.revision : null;
        if (curRev !== expectedRevision) {
          swapped = false;
          return;
        }
        swapped = true;
        store.put({ id: 'registry', data: validated });
      };
      tx.oncomplete = () => resolve(swapped);
      tx.onerror = () => reject(tx.error ?? new Error('Failed CAS write on region registry'));
      tx.onabort = () => reject(tx.error ?? new Error('Aborted CAS write on region registry'));
    });
  }

  async #putIdbBlob(storeName: 'staging_blobs' | 'committed_blobs', key: string, bytes: Uint8Array): Promise<void> {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      tx.objectStore(storeName).put({ key, bytes: new Uint8Array(bytes) });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed IDB blob write in ${storeName}`));
    });
  }

  async #getIdbBlob(storeName: 'staging_blobs' | 'committed_blobs', key: string): Promise<Uint8Array | null> {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => {
        const res = req.result as BlobRecord | undefined;
        resolve(res ? new Uint8Array(res.bytes) : null);
      };
      req.onerror = () => reject(req.error ?? new Error(`Failed IDB blob read in ${storeName}`));
    });
  }

  async #delIdbBlob(storeName: 'staging_blobs' | 'committed_blobs', key: string): Promise<void> {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`Failed IDB blob delete in ${storeName}`));
    });
  }

  async #listIdbKeys(storeName: 'staging_blobs' | 'committed_blobs'): Promise<string[]> {
    const db = await this.#openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const req = tx.objectStore(storeName).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]).map(String).sort());
      req.onerror = () => reject(req.error ?? new Error(`Failed IDB key listing in ${storeName}`));
    });
  }

  async writeStagingAsset(stagingKey: string, data: Uint8Array): Promise<void> {
    const key = validateStorageObjectKey(stagingKey);
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      const fh = await resolveOpfsSubFile(opfs, 'staging', key, true);
      const writable = await fh!.createWritable();
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      await writable.write(buf);
      await writable.close();
      return;
    }
    await this.#putIdbBlob('staging_blobs', key, data);
  }

  async readStagingAsset(stagingKey: string): Promise<Uint8Array | null> {
    const key = validateStorageObjectKey(stagingKey);
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      const fh = await resolveOpfsSubFile(opfs, 'staging', key, false);
      if (!fh) return null;
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
    return this.#getIdbBlob('staging_blobs', key);
  }

  async deleteStagingAsset(stagingKey: string): Promise<void> {
    const key = validateStorageObjectKey(stagingKey);
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      await deleteOpfsSubFile(opfs, 'staging', key);
    }
    await this.#delIdbBlob('staging_blobs', key);
  }

  async listStagingKeys(): Promise<string[]> {
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      try {
        const dir = await opfs.getDirectoryHandle('staging', { create: false });
        return await listOpfsRecursive(dir);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return [];
        throw err;
      }
    }
    return this.#listIdbKeys('staging_blobs');
  }

  async promoteStagedAsset(stagingKey: string, committedKey: string): Promise<void> {
    const sKey = validateStorageObjectKey(stagingKey);
    const cKey = validateStorageObjectKey(committedKey);
    const staged = await this.readStagingAsset(sKey);
    if (!staged) {
      throw new Error(`Missing staged asset for promotion: ${sKey}`);
    }
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      const fh = await resolveOpfsSubFile(opfs, 'committed', cKey, true);
      const writable = await fh!.createWritable();
      const buf = staged.buffer.slice(staged.byteOffset, staged.byteOffset + staged.byteLength) as ArrayBuffer;
      await writable.write(buf);
      await writable.close();
      await this.deleteStagingAsset(sKey);
      return;
    }
    await this.#putIdbBlob('committed_blobs', cKey, staged);
    await this.deleteStagingAsset(sKey);
  }

  async readCommittedRange(committedKey: string, offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset + length)) {
      throw new RangeError(`Invalid range read bounds: offset=${offset}, length=${length}`);
    }
    const key = validateStorageObjectKey(committedKey);
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      const fh = await resolveOpfsSubFile(opfs, 'committed', key, false);
      if (!fh) throw new Error(`MISSING_COMMITTED_ASSET: ${key}`);
      const file = await fh.getFile();
      if (offset > file.size) {
        throw new RangeError(`Range offset ${offset} exceeds asset length ${file.size}`);
      }
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const slice = file.slice(offset, Math.min(file.size, offset + length));
      return await slice.arrayBuffer();
    }
    const full = await this.#getIdbBlob('committed_blobs', key);
    if (!full) throw new Error(`MISSING_COMMITTED_ASSET: ${key}`);
    if (offset > full.byteLength) {
      throw new RangeError(`Range offset ${offset} exceeds asset length ${full.byteLength}`);
    }
    const sub = full.subarray(offset, Math.min(full.byteLength, offset + length));
    return sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength) as ArrayBuffer;
  }

  async readCommittedAll(committedKey: string): Promise<Uint8Array> {
    const key = validateStorageObjectKey(committedKey);
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      const fh = await resolveOpfsSubFile(opfs, 'committed', key, false);
      if (!fh) throw new Error(`MISSING_COMMITTED_ASSET: ${key}`);
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
    const full = await this.#getIdbBlob('committed_blobs', key);
    if (!full) throw new Error(`MISSING_COMMITTED_ASSET: ${key}`);
    return full;
  }

  async committedStat(committedKey: string): Promise<{ readonly exists: boolean; readonly byteLength: number }> {
    const key = validateStorageObjectKey(committedKey);
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      const fh = await resolveOpfsSubFile(opfs, 'committed', key, false);
      if (!fh) return { exists: false, byteLength: 0 };
      const file = await fh.getFile();
      return { exists: true, byteLength: file.size };
    }
    const full = await this.#getIdbBlob('committed_blobs', key);
    return full ? { exists: true, byteLength: full.byteLength } : { exists: false, byteLength: 0 };
  }

  async deleteCommittedAsset(committedKey: string): Promise<void> {
    const key = validateStorageObjectKey(committedKey);
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      await deleteOpfsSubFile(opfs, 'committed', key);
    }
    await this.#delIdbBlob('committed_blobs', key);
  }

  async listCommittedKeys(): Promise<string[]> {
    const opfs = await this.#getOpfsRoot();
    if (opfs) {
      try {
        const dir = await opfs.getDirectoryHandle('committed', { create: false });
        return await listOpfsRecursive(dir);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') return [];
        throw err;
      }
    }
    return this.#listIdbKeys('committed_blobs');
  }

  async withExclusiveLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
    const runLocal = async () => {
      const prior = this.#localLocks.get(lockName) ?? Promise.resolve();
      let release!: () => void;
      const cur = new Promise<void>((res) => {
        release = res;
      });
      const tail = prior.then(() => cur, () => cur);
      this.#localLocks.set(lockName, tail);
      await prior.catch(() => undefined);
      try {
        return await fn();
      } finally {
        release();
        if (this.#localLocks.get(lockName) === tail) {
          this.#localLocks.delete(lockName);
        }
      }
    };

    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return await navigator.locks.request(`${this.storageNamespace}:${lockName}`, { mode: 'exclusive' }, async () => runLocal());
    }
    return await runLocal();
  }

  broadcastEvent(ev: RegionStorageBroadcastEvent): void {
    for (const listener of this.#localListeners) {
      listener(ev);
    }
    this.#channel?.postMessage(ev);
  }

  subscribeEvents(listener: (ev: RegionStorageBroadcastEvent) => void): () => void {
    this.#localListeners.add(listener);
    return () => {
      this.#localListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.#channel?.close();
    this.#channel = null;
    this.#localListeners.clear();
    if (this.#dbPromise) {
      const db = await this.#dbPromise;
      db.close();
      this.#dbPromise = null;
    }
  }
}

/** Structural subset of @capacitor/filesystem needed for app-private Android storage. */
export interface CapacitorFilesystemLike {
  readFile(options: { path: string; directory: string; encoding?: string }): Promise<{ data: string | Blob }>;
  writeFile(options: { path: string; data: string; directory: string; encoding?: string; recursive?: boolean }): Promise<{ uri?: string }>;
  deleteFile(options: { path: string; directory: string }): Promise<void>;
  mkdir(options: { path: string; directory: string; recursive?: boolean }): Promise<void>;
  readdir(options: { path: string; directory: string }): Promise<{ files: ReadonlyArray<{ name: string; type?: string; size?: number } | string> }>;
  stat(options: { path: string; directory: string }): Promise<{ size: number; type?: string }>;
  rename(options: { from: string; to: string; directory: string; toDirectory?: string }): Promise<void>;
}

const CAPACITOR_CHUNK_BYTES = 128 * 1024;

function encodeStoragePathForCap(key: string): string {
  return encodeURIComponent(validateStorageObjectKey(key));
}

function decodeStoragePathForCap(encoded: string): string {
  return decodeURIComponent(encoded);
}

/**
 * Android/Capacitor app-private region storage adapter targeting Directory.Data/railway-ceo-regions-v1.
 * Binary assets are stored in fixed-size chunk files so PMTiles range reads only decode touched
 * slices instead of materializing full archives in WebView RAM.
 *
 * Physical Android hardware execution and low-disk behavior are tracked open under C08; this class
 * records physicalDeviceVerified = false when executed against host or mocked bridges.
 */
export class CapacitorFilesystemRegionBackend implements RegionStorageBackend {
  readonly backendName = 'capacitor-filesystem-region-storage';
  readonly storageNamespace: string;
  readonly physicalDeviceVerified: boolean;
  readonly activeBinaryStoreMode = 'capacitor-chunked-fs' as const;

  readonly #fs: CapacitorFilesystemLike;
  readonly #directory: string;
  readonly #quotaEstimator?: () => Promise<StorageQuotaReport>;
  readonly #locks = new Map<string, Promise<unknown>>();
  readonly #listeners = new Set<(ev: RegionStorageBroadcastEvent) => void>();

  constructor(options: {
    filesystem: CapacitorFilesystemLike;
    directory?: string;
    namespace?: string;
    physicalDeviceVerified?: boolean;
    quotaEstimator?: () => Promise<StorageQuotaReport>;
  }) {
    this.#fs = options.filesystem;
    this.#directory = options.directory ?? 'DATA';
    this.storageNamespace = options.namespace ?? 'railway-ceo-regions-v1';
    this.physicalDeviceVerified = options.physicalDeviceVerified ?? false;
    this.#quotaEstimator = options.quotaEstimator;
  }

  get #registryPath(): string {
    return `${this.storageNamespace}/registry.json`;
  }

  #stagingPath(key: string): string {
    return `${this.storageNamespace}/staging/${encodeStoragePathForCap(key)}`;
  }

  #committedDir(key: string): string {
    return `${this.storageNamespace}/committed/${encodeStoragePathForCap(key)}`;
  }

  async checkStorageQuota(): Promise<StorageQuotaReport> {
    if (this.#quotaEstimator) {
      return this.#quotaEstimator();
    }
    return {
      backendName: this.backendName,
      quotaStatus: 'UNKNOWN',
      totalQuotaBytes: null,
      usedBytes: null,
      availableBytes: null,
      persistentStorageGranted: null,
    };
  }

  async readState(): Promise<InstalledRegionRegistry | null> {
    try {
      const res = await this.#fs.readFile({
        path: this.#registryPath,
        directory: this.#directory,
        encoding: 'utf8',
      });
      const text = typeof res.data === 'string' ? res.data : await res.data.text();
      return decodeInstalledRegionRegistry(JSON.parse(text));
    } catch {
      return null;
    }
  }

  async compareAndSwapState(expectedRevision: number | null, nextState: InstalledRegionRegistry): Promise<boolean> {
    return this.withExclusiveLock('__registry_cas__', async () => {
      const validated = decodeInstalledRegionRegistry(structuredClone(nextState));
      const cur = await this.readState();
      const curRev = cur ? cur.revision : null;
      if (curRev !== expectedRevision) {
        return false;
      }
      const tmpPath = `${this.storageNamespace}/registry.tmp.json`;
      await this.#fs.mkdir({ path: this.storageNamespace, directory: this.#directory, recursive: true }).catch(() => undefined);
      await this.#fs.writeFile({
        path: tmpPath,
        data: JSON.stringify(validated),
        directory: this.#directory,
        encoding: 'utf8',
        recursive: true,
      });
      await this.#fs.rename({
        from: tmpPath,
        to: this.#registryPath,
        directory: this.#directory,
      });
      return true;
    });
  }

  async writeStagingAsset(stagingKey: string, data: Uint8Array): Promise<void> {
    await this.#fs.mkdir({ path: `${this.storageNamespace}/staging`, directory: this.#directory, recursive: true }).catch(() => undefined);
    await this.#fs.writeFile({
      path: this.#stagingPath(stagingKey),
      data: encodeBytesToBase64(data),
      directory: this.#directory,
      recursive: true,
    });
  }

  async readStagingAsset(stagingKey: string): Promise<Uint8Array | null> {
    try {
      const res = await this.#fs.readFile({
        path: this.#stagingPath(stagingKey),
        directory: this.#directory,
      });
      if (typeof res.data === 'string') {
        return decodeBase64ToBytes(res.data);
      }
      return new Uint8Array(await res.data.arrayBuffer());
    } catch {
      return null;
    }
  }

  async deleteStagingAsset(stagingKey: string): Promise<void> {
    try {
      await this.#fs.deleteFile({ path: this.#stagingPath(stagingKey), directory: this.#directory });
    } catch {
      // ignore missing
    }
  }

  async listStagingKeys(): Promise<string[]> {
    try {
      const dir = await this.#fs.readdir({ path: `${this.storageNamespace}/staging`, directory: this.#directory });
      return dir.files
        .map((f) => decodeStoragePathForCap(typeof f === 'string' ? f : f.name))
        .sort();
    } catch {
      return [];
    }
  }

  async promoteStagedAsset(stagingKey: string, committedKey: string): Promise<void> {
    const data = await this.readStagingAsset(stagingKey);
    if (!data) {
      throw new Error(`Missing staged Capacitor asset: ${stagingKey}`);
    }
    const baseDir = this.#committedDir(committedKey);
    await this.#fs.mkdir({ path: baseDir, directory: this.#directory, recursive: true }).catch(() => undefined);
    const chunkCount = Math.max(1, Math.ceil(data.byteLength / CAPACITOR_CHUNK_BYTES));
    const meta = {
      byteLength: data.byteLength,
      chunkSize: CAPACITOR_CHUNK_BYTES,
      chunkCount,
    };
    for (let i = 0; i < chunkCount; i++) {
      const start = i * CAPACITOR_CHUNK_BYTES;
      const end = Math.min(data.byteLength, start + CAPACITOR_CHUNK_BYTES);
      const slice = data.subarray(start, end);
      await this.#fs.writeFile({
        path: `${baseDir}/chunk_${i}.bin`,
        data: encodeBytesToBase64(slice),
        directory: this.#directory,
        recursive: true,
      });
    }
    await this.#fs.writeFile({
      path: `${baseDir}/meta.json`,
      data: JSON.stringify(meta),
      directory: this.#directory,
      encoding: 'utf8',
      recursive: true,
    });
    await this.deleteStagingAsset(stagingKey);
  }

  async #readChunk(baseDir: string, idx: number): Promise<Uint8Array> {
    const res = await this.#fs.readFile({
      path: `${baseDir}/chunk_${idx}.bin`,
      directory: this.#directory,
    });
    return typeof res.data === 'string' ? decodeBase64ToBytes(res.data) : new Uint8Array(await res.data.arrayBuffer());
  }

  async #readMeta(committedKey: string): Promise<{ byteLength: number; chunkSize: number; chunkCount: number } | null> {
    try {
      const res = await this.#fs.readFile({
        path: `${this.#committedDir(committedKey)}/meta.json`,
        directory: this.#directory,
        encoding: 'utf8',
      });
      const text = typeof res.data === 'string' ? res.data : await res.data.text();
      return JSON.parse(text) as { byteLength: number; chunkSize: number; chunkCount: number };
    } catch {
      return null;
    }
  }

  async readCommittedRange(committedKey: string, offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset + length)) {
      throw new RangeError(`Invalid range read bounds: offset=${offset}, length=${length}`);
    }
    const meta = await this.#readMeta(committedKey);
    if (!meta) {
      throw new Error(`MISSING_COMMITTED_ASSET: ${committedKey}`);
    }
    if (offset > meta.byteLength) {
      throw new RangeError(`Range offset ${offset} exceeds asset length ${meta.byteLength}`);
    }
    const targetEnd = Math.min(meta.byteLength, offset + length);
    const outLength = Math.max(0, targetEnd - offset);
    const out = new Uint8Array(outLength);
    if (outLength === 0) return out.buffer;

    const firstChunk = Math.floor(offset / meta.chunkSize);
    const lastChunk = Math.floor((targetEnd - 1) / meta.chunkSize);
    const baseDir = this.#committedDir(committedKey);
    let writePos = 0;
    for (let idx = firstChunk; idx <= lastChunk; idx++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const chunkBytes = await this.#readChunk(baseDir, idx);
      const chunkStartAbs = idx * meta.chunkSize;
      const localStart = Math.max(0, offset - chunkStartAbs);
      const localEnd = Math.min(chunkBytes.byteLength, targetEnd - chunkStartAbs);
      const piece = chunkBytes.subarray(localStart, localEnd);
      out.set(piece, writePos);
      writePos += piece.byteLength;
    }
    return out.buffer;
  }

  async readCommittedAll(committedKey: string): Promise<Uint8Array> {
    const stat = await this.committedStat(committedKey);
    if (!stat.exists) {
      throw new Error(`MISSING_COMMITTED_ASSET: ${committedKey}`);
    }
    return new Uint8Array(await this.readCommittedRange(committedKey, 0, stat.byteLength));
  }

  async committedStat(committedKey: string): Promise<{ readonly exists: boolean; readonly byteLength: number }> {
    const meta = await this.#readMeta(committedKey);
    return meta ? { exists: true, byteLength: meta.byteLength } : { exists: false, byteLength: 0 };
  }

  async deleteCommittedAsset(committedKey: string): Promise<void> {
    const baseDir = this.#committedDir(committedKey);
    const meta = await this.#readMeta(committedKey);
    if (meta) {
      for (let i = 0; i < meta.chunkCount; i++) {
        await this.#fs.deleteFile({ path: `${baseDir}/chunk_${i}.bin`, directory: this.#directory }).catch(() => undefined);
      }
    }
    await this.#fs.deleteFile({ path: `${baseDir}/meta.json`, directory: this.#directory }).catch(() => undefined);
  }

  async listCommittedKeys(): Promise<string[]> {
    try {
      const dir = await this.#fs.readdir({ path: `${this.storageNamespace}/committed`, directory: this.#directory });
      return dir.files
        .map((f) => decodeStoragePathForCap(typeof f === 'string' ? f : f.name))
        .sort();
    } catch {
      return [];
    }
  }

  async withExclusiveLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.#locks.get(lockName) ?? Promise.resolve();
    let release!: () => void;
    const cur = new Promise<void>((res) => {
      release = res;
    });
    const tail = prior.then(() => cur, () => cur);
    this.#locks.set(lockName, tail);
    await prior.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.#locks.get(lockName) === tail) {
        this.#locks.delete(lockName);
      }
    }
  }

  broadcastEvent(ev: RegionStorageBroadcastEvent): void {
    for (const listener of this.#listeners) {
      listener(ev);
    }
  }

  subscribeEvents(listener: (ev: RegionStorageBroadcastEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.#listeners.clear();
  }
}
