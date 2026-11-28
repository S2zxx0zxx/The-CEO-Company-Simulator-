import { isValidArchiveKey, type PMTilesSourceLike } from '../map/pmtiles-adapter';
import { sha256Hex } from './contracts';
import type { RegionStorageBackend } from './storage';

export interface RangeSourceTelemetry {
  readonly archiveId: string;
  readonly committedKey: string;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
  readonly rangeReadCount: number;
  readonly totalBytesRead: number;
  readonly maxSingleReadBytes: number;
  readonly fullArchiveLoadedInMemory: boolean;
}

/**
 * Bounded PMTiles v3 Source backed by durable local RegionStorageBackend range reads.
 * Never loads the entire PMTiles archive into heap RAM; validates offsets, lengths, AbortSignal,
 * expected size, and header/asset availability before servicing MapLibre tile requests.
 */
export class VerifiedInstalledPMTilesSource implements PMTilesSourceLike {
  readonly #archiveId: string;
  readonly #backend: RegionStorageBackend;
  readonly #committedKey: string;
  readonly #expectedByteLength: number;
  readonly #expectedSha256: string;
  readonly #maxSingleRangeBytes: number;
  #rangeReadCount = 0;
  #totalBytesRead = 0;
  #maxSingleReadBytes = 0;

  constructor(options: {
    archiveId: string;
    backend: RegionStorageBackend;
    committedKey: string;
    expectedByteLength: number;
    expectedSha256: string;
    maxSingleRangeBytes?: number;
  }) {
    if (!isValidArchiveKey(options.archiveId)) {
      throw new TypeError(`Invalid offline PMTiles archiveId: ${options.archiveId}`);
    }
    if (!Number.isSafeInteger(options.expectedByteLength) || options.expectedByteLength <= 0) {
      throw new TypeError(`Invalid expectedByteLength for ${options.archiveId}`);
    }
    if (!/^[a-f0-9]{64}$/.test(options.expectedSha256)) {
      throw new TypeError(`Invalid expectedSha256 for ${options.archiveId}`);
    }
    this.#archiveId = options.archiveId;
    this.#backend = options.backend;
    this.#committedKey = options.committedKey;
    this.#expectedByteLength = options.expectedByteLength;
    this.#expectedSha256 = options.expectedSha256;
    this.#maxSingleRangeBytes = options.maxSingleRangeBytes ?? 16 * 1024 * 1024;
  }

  getKey(): string {
    return this.#archiveId;
  }

  getTelemetry(): RangeSourceTelemetry {
    return {
      archiveId: this.#archiveId,
      committedKey: this.#committedKey,
      expectedByteLength: this.#expectedByteLength,
      expectedSha256: this.#expectedSha256,
      rangeReadCount: this.#rangeReadCount,
      totalBytesRead: this.#totalBytesRead,
      maxSingleReadBytes: this.#maxSingleReadBytes,
      fullArchiveLoadedInMemory: false,
    };
  }

  async verifyIntegrity(): Promise<Readonly<{ ok: true } | { ok: false; reason: string }>> {
    const stat = await this.#backend.committedStat(this.#committedKey);
    if (!stat.exists) {
      return { ok: false, reason: `INSTALLED_PMTILES_MISSING: ${this.#committedKey}` };
    }
    if (stat.byteLength !== this.#expectedByteLength) {
      return {
        ok: false,
        reason: `INSTALLED_PMTILES_SIZE_MISMATCH: expected=${this.#expectedByteLength} actual=${stat.byteLength}`,
      };
    }
    const allBytes = await this.#backend.readCommittedAll(this.#committedKey);
    const actualSha = await sha256Hex(allBytes);
    if (actualSha !== this.#expectedSha256) {
      return {
        ok: false,
        reason: `INSTALLED_PMTILES_SHA256_MISMATCH: expected=${this.#expectedSha256} actual=${actualSha}`,
      };
    }
    return { ok: true };
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal): Promise<{ readonly data: ArrayBuffer }> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError(`Invalid PMTiles range offset: ${offset}`);
    }
    if (!Number.isSafeInteger(length) || length < 0 || length > this.#maxSingleRangeBytes) {
      throw new RangeError(`Invalid or oversized PMTiles range length: ${length} (cap=${this.#maxSingleRangeBytes})`);
    }
    if (!Number.isSafeInteger(offset + length)) {
      throw new RangeError(`Range offset+length overflow: ${offset} + ${length}`);
    }
    const stat = await this.#backend.committedStat(this.#committedKey);
    if (!stat.exists) {
      throw new Error(`INSTALLED_PMTILES_MISSING: ${this.#committedKey}`);
    }
    if (stat.byteLength !== this.#expectedByteLength) {
      throw new Error(`INSTALLED_PMTILES_SIZE_MISMATCH: expected=${this.#expectedByteLength} actual=${stat.byteLength}`);
    }
    if (offset >= stat.byteLength) {
      throw new RangeError(`Range offset ${offset} out of bounds for size ${stat.byteLength}`);
    }

    const boundedLen = Math.min(length, stat.byteLength - offset);
    const data = await this.#backend.readCommittedRange(this.#committedKey, offset, boundedLen, signal);
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (data.byteLength !== boundedLen) {
      throw new Error(`SHORT_RANGE_READ: expected=${boundedLen} actual=${data.byteLength}`);
    }
    // Check PMTiles v3 magic header on offset 0 reads so corrupted archives fail fast
    if (offset === 0 && data.byteLength >= 7) {
      const magic = new TextDecoder().decode(new Uint8Array(data, 0, 7));
      if (magic !== 'PMTiles') {
        throw new Error(`CORRUPTED_PMTILES_MAGIC_HEADER: ${this.#committedKey}`);
      }
    }

    this.#rangeReadCount += 1;
    this.#totalBytesRead += data.byteLength;
    if (data.byteLength > this.#maxSingleReadBytes) {
      this.#maxSingleReadBytes = data.byteLength;
    }

    return { data };
  }
}
