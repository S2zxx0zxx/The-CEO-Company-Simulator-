import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import type { OracleQueryRequest, OracleRawResponse } from './contracts';

export interface StrictOracleClientOptions {
  readonly javaExe?: string;
  readonly strictCacheDir: string;
  readonly upstreamCacheDir?: string;
  readonly c06JarPath?: string;
  readonly orrThinJarPath?: string;
  readonly runtimeClasspathFile?: string;
  readonly jvmMaxHeapMb?: number;
  readonly defaultTimeoutMs?: number;
}

function buildFullClasspath(opts: StrictOracleClientOptions): string {
  const wsRoot = process.cwd();
  const c06Jar = opts.c06JarPath ?? path.resolve(wsRoot, 'c06_oracle/java/c06-strict-oracle.jar');
  const thinJar = opts.orrThinJarPath ?? path.resolve(wsRoot, 'c04_c06_tools/openrailrouting/target/railway_routing-1.2-thin.jar');
  const cpFile = opts.runtimeClasspathFile ?? path.resolve(wsRoot, 'c04_c06_tools/openrailrouting/target/runtime-classpath.txt');
  const runtimeCp = readFileSync(cpFile, 'utf8').trim();
  const sep = process.platform === 'win32' ? ';' : ':';
  return [c06Jar, thinJar, runtimeCp].join(sep);
}

/**
 * Local offline IPC client for pinned OpenRailRouting + StrictOracleRunner Java adapter.
 * Enforces Realism-only strict preflight checks, identity verification, timeouts, and fail-closed errors.
 */
export class StrictOracleClient {
  readonly #javaExe: string;
  readonly #classpath: string;
  readonly #strictCacheDir: string;
  readonly #upstreamCacheDir?: string;
  readonly #jvmMaxHeapMb: number;
  readonly #defaultTimeoutMs: number;

  #proc: ChildProcessWithoutNullStreams | null = null;
  #rl: readline.Interface | null = null;
  #pendingResolve: ((line: string) => void) | null = null;
  #pendingReject: ((err: Error) => void) | null = null;
  #startupBanner: { startupLoadMs: number; jvmMaxHeapBytes: number; jvmUsedHeapBytes: number } | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(opts: StrictOracleClientOptions) {
    const defaultJdk =
      process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
        : process.platform === 'win32'
          ? 'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe'
          : 'java';
    this.#javaExe = opts.javaExe ?? defaultJdk;
    this.#classpath = buildFullClasspath(opts);
    this.#strictCacheDir = opts.strictCacheDir;
    this.#upstreamCacheDir = opts.upstreamCacheDir;
    this.#jvmMaxHeapMb = opts.jvmMaxHeapMb ?? 256;
    this.#defaultTimeoutMs = opts.defaultTimeoutMs ?? 10000;
  }

  get startupTelemetry() {
    return this.#startupBanner;
  }

  /** Validate Realism isolation and canonical graph/profile/policy identity before calling oracle. */
  #preflightStrictRequest(req: OracleQueryRequest): OracleRawResponse | null {
    const t0 = performance.now();
    if (req.engineMode !== 'UPSTREAM_UNMODIFIED') {
      if (req.policy.mode !== 'Realism' || req.policy.inferences.length > 0) {
        return {
          requestId: req.requestId,
          engineMode: 'STRICT_ORACLE',
          ok: false,
          statusCode: 'STRICT_PROFILE_UNSUPPORTED',
          reason: 'EASY_MODE_INFERENCE_FORBIDDEN_IN_STRICT_ORACLE',
          elapsedMs: performance.now() - t0,
        };
      }
      if (req.expectedGraphSha256 !== req.actualGraphSha256) {
        return {
          requestId: req.requestId,
          engineMode: 'STRICT_ORACLE',
          ok: false,
          statusCode: 'STALE_GRAPH',
          reason: `GRAPH_SHA256_MISMATCH: expected=${req.expectedGraphSha256} actual=${req.actualGraphSha256}`,
          elapsedMs: performance.now() - t0,
        };
      }
      if (req.expectedProfileSha256 !== req.actualProfileSha256) {
        return {
          requestId: req.requestId,
          engineMode: 'STRICT_ORACLE',
          ok: false,
          statusCode: 'STALE_PROFILE',
          reason: 'PROFILE_SHA256_MISMATCH',
          elapsedMs: performance.now() - t0,
        };
      }
      if (req.expectedPolicySha256 !== req.actualPolicySha256) {
        return {
          requestId: req.requestId,
          engineMode: 'STRICT_ORACLE',
          ok: false,
          statusCode: 'STALE_POLICY',
          reason: 'POLICY_SHA256_MISMATCH',
          elapsedMs: performance.now() - t0,
        };
      }
    }
    return null;
  }

  async start(timeoutMs = 15000): Promise<void> {
    if (this.#proc) return;
    const args = [
      `-Xmx${this.#jvmMaxHeapMb}m`,
      '-cp',
      this.#classpath,
      'com.railwayceo.c06.StrictOracleRunner',
      'query-stdio',
      '--strict-cache',
      this.#strictCacheDir,
    ];
    if (this.#upstreamCacheDir) {
      args.push('--upstream-cache', this.#upstreamCacheDir);
    }
    const child = spawn(this.#javaExe, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#proc = child;
    const rl = readline.createInterface({ input: child.stdout });
    this.#rl = rl;

    const stderrChunks: string[] = [];
    child.stderr.on('data', (chunk) => {
      if (this.#proc !== child) return;
      stderrChunks.push(String(chunk));
    });
    child.on('exit', (code, signal) => {
      if (this.#proc !== child) return;
      if (this.#pendingReject) {
        this.#pendingReject(new Error(`ORACLE_PROCESS_EXITED: code=${code} signal=${signal} stderr=${stderrChunks.join('').slice(-300)}`));
        this.#pendingResolve = null;
        this.#pendingReject = null;
      }
      this.#rl?.close();
      this.#proc = null;
      this.#rl = null;
    });

    rl.on('line', (line) => {
      if (this.#proc !== child) return;
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) {
        if (trimmed.length > 0) stderrChunks.push(trimmed + '\n');
        return;
      }
      if (this.#pendingResolve) {
        const res = this.#pendingResolve;
        this.#pendingResolve = null;
        this.#pendingReject = null;
        res(trimmed);
      }
    });

    try {
      const readyLine = await this.#awaitNextLine(timeoutMs);
      const parsed = JSON.parse(readyLine);
      if (parsed.type !== 'ready') {
        throw new Error(`Unexpected oracle ready banner: ${readyLine}`);
      }
      this.#startupBanner = {
        startupLoadMs: parsed.startupLoadMs,
        jvmMaxHeapBytes: parsed.jvmMaxHeapBytes,
        jvmUsedHeapBytes: parsed.jvmUsedHeapBytes,
      };
    } catch (err) {
      if (this.#proc === child) {
        this.#proc = null;
        this.#rl?.close();
        this.#rl = null;
        child.kill('SIGKILL');
      }
      throw err;
    }
  }

  #awaitNextLine(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingResolve = null;
        this.#pendingReject = null;
        const p = this.#proc;
        const r = this.#rl;
        this.#proc = null;
        this.#rl = null;
        r?.close();
        p?.kill('SIGKILL');
        reject(new Error(`ORACLE_TIMEOUT_EXCEEDED: ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pendingResolve = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.#pendingReject = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  async query(req: OracleQueryRequest, options: { timeoutMs?: number; simulateHangDelayMs?: number } = {}): Promise<OracleRawResponse> {
    const prefail = this.#preflightStrictRequest(req);
    if (prefail) return prefail;

    return (this.#queue = this.#queue.then(async () => {
      const t0 = performance.now();
      const timeoutMs = options.timeoutMs ?? this.#defaultTimeoutMs;
      try {
        if (!this.#proc) {
          await this.start(Math.max(15000, timeoutMs));
        }
        const payload = JSON.stringify({
          requestId: req.requestId,
          engineMode: req.engineMode ?? 'STRICT_ORACLE',
          upstreamProfile: req.upstreamProfile ?? 'upstream_electric',
          objective: req.objective,
          allowReversal: req.allowReversal,
          stops: req.stops,
          train: req.train,
          simulateHangMs: options.simulateHangDelayMs ?? 0,
        });
        const linePromise = this.#awaitNextLine(timeoutMs);
        this.#proc!.stdin.write(payload + '\n');
        const line = await linePromise;
        return JSON.parse(line) as OracleRawResponse;
      } catch (err) {
        return {
          requestId: req.requestId,
          engineMode: req.engineMode ?? 'STRICT_ORACLE',
          ok: false,
          statusCode: 'ORACLE_EXECUTION_ERROR',
          reason: err instanceof Error ? err.message : String(err),
          elapsedMs: performance.now() - t0,
        };
      }
    })) as Promise<OracleRawResponse>;
  }

  /** One-shot CLI invocation for cold JVM startup + query measurement or forced process failure testing. */
  queryOnceCli(reqFilePath: string, options: { strictCacheDir?: string; timeoutMs?: number } = {}): OracleRawResponse {
    const res = spawnSync(
      this.#javaExe,
      [
        `-Xmx${this.#jvmMaxHeapMb}m`,
        '-cp',
        this.#classpath,
        'com.railwayceo.c06.StrictOracleRunner',
        'query-once',
        '--strict-cache',
        options.strictCacheDir ?? this.#strictCacheDir,
        '--req',
        reqFilePath,
      ],
      { encoding: 'utf8', timeout: options.timeoutMs ?? 15000 },
    );
    if (res.error || res.status !== 0) {
      return {
        requestId: path.basename(reqFilePath),
        engineMode: 'STRICT_ORACLE',
        ok: false,
        statusCode: 'ORACLE_EXECUTION_ERROR',
        reason: res.error?.message ?? `exit=${res.status}: ${String(res.stderr).slice(-300)}`,
        elapsedMs: 0,
      };
    }
    const jsonLine = res.stdout
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .reverse()
      .find((l) => l.startsWith('{'));
    if (!jsonLine) {
      throw new Error(`No JSON response in queryOnceCli stdout: ${res.stdout}`);
    }
    return JSON.parse(jsonLine) as OracleRawResponse;
  }

  async close(): Promise<void> {
    if (this.#proc) {
      this.#proc.stdin.end();
      await new Promise((r) => setTimeout(r, 100));
      if (this.#proc) {
        this.#proc.kill();
        this.#proc = null;
      }
    }
    this.#rl?.close();
    this.#rl = null;
  }
}
