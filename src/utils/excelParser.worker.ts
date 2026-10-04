import { parseExcelBuffer } from "./parser";

interface WorkerParseRequest {
  id: number;
  buffer: ArrayBuffer;
  fileName: string;
  storageSnapshot?: Record<string, string | null>;
}

const workerScope = globalThis as any;

let currentStorageSnapshot: Record<string, string | null> = {};
let capturedLastUploadTrace: string | null = null;

if (typeof workerScope.localStorage === "undefined") {
  const storageShim = {
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(currentStorageSnapshot, key)
        ? currentStorageSnapshot[key]
        : null;
    },
    setItem(key: string, value: string): void {
      const strVal = String(value);
      currentStorageSnapshot[key] = strVal;
      if (key === "docuCtrl_last_upload_trace") {
        capturedLastUploadTrace = strVal;
      }
    },
    removeItem(key: string): void {
      delete currentStorageSnapshot[key];
    },
    clear(): void {
      currentStorageSnapshot = {};
    },
  };
  workerScope.localStorage = storageShim;
  if (typeof workerScope.window === "undefined") {
    workerScope.window = {
      localStorage: storageShim,
      dispatchEvent: () => true,
    };
  }
}

workerScope.onmessage = (event: MessageEvent<WorkerParseRequest>) => {
  const { id, buffer, fileName, storageSnapshot } = event.data;
  try {
    currentStorageSnapshot = { ...(storageSnapshot || {}) };
    capturedLastUploadTrace = null;
    const rows = parseExcelBuffer(buffer, fileName);
    workerScope.postMessage({
      id,
      ok: true,
      rows,
      lastUploadTrace: capturedLastUploadTrace,
    });
  } catch (err: any) {
    workerScope.postMessage({
      id,
      ok: false,
      error: err?.message || String(err),
    });
  }
};
