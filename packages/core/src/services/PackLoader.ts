/**
 * PackLoader Service
 * 
 * Handles lazy pack loading with:
 * - Streaming downloads with progress callbacks
 * - SHA-256 validation
 * - Retry logic (3 attempts with exponential backoff)
 * - Partial download detection, kept distinct from a wrong-file mismatch
 * - Corrupted IndexedDB blob recovery
 * - Pack caching in IndexedDB
 */

import type { PackEntry, PackManifest } from '../schemas/PackManifest';
import { validateManifest, isPackCompatible } from '../schemas/PackManifest';
import { sqliteWorker } from './SQLiteWorkerPool';

/**
 * An error meaning the bytes on the server are not the bytes the manifest
 * describes -- a stale release asset, or a manifest generated against a
 * different build. Retrying cannot fix it, so the retry loop rethrows on sight.
 */
export interface PackContentError extends Error {
  isContentMismatch?: true;
}

function contentMismatch(message: string): PackContentError {
  const error: PackContentError = new Error(message);
  error.isContentMismatch = true;
  return error;
}

export interface DownloadProgress {
  packId: string;
  loaded: number;
  total: number;
  percentage: number;
  stage: 'downloading' | 'validating' | 'extracting' | 'caching' | 'complete';
}

export interface PackLoaderOptions {
  /** Base URL for pack manifest (GitHub Releases URL) */
  manifestUrl: string;
  
  /** Current app version for compatibility checks */
  appVersion: string;
  
  /** Progress callback */
  onProgress?: (progress: DownloadProgress) => void;
  
  /** Maximum retry attempts */
  maxRetries?: number;
  
  /** Initial retry delay in ms */
  retryDelay?: number;
}

export class PackLoader {
  private manifest: PackManifest | null = null;
  private options: Required<PackLoaderOptions>;
  private db: IDBDatabase | null = null;
  
  constructor(options: PackLoaderOptions) {
    this.options = {
      ...options,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      onProgress: options.onProgress ?? (() => {})
    };
  }
  
  /**
   * Initialize IndexedDB for pack caching
   */
  private async initDB(): Promise<void> {
    if (this.db) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('projectbible-packs', 1);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Store for cached pack files (SQLite blobs)
        if (!db.objectStoreNames.contains('pack_files')) {
          const packStore = db.createObjectStore('pack_files', { keyPath: 'id' });
          packStore.createIndex('version', 'version', { unique: false });
        }
        
        // Store for pack metadata
        if (!db.objectStoreNames.contains('pack_metadata')) {
          db.createObjectStore('pack_metadata', { keyPath: 'id' });
        }
      };
    });
  }
  
  /**
   * Fetch and validate manifest
   */
  async fetchManifest(): Promise<PackManifest> {
    try {
      console.log('📡 Fetching manifest from:', this.options.manifestUrl);
      const response = await fetch(this.options.manifestUrl, {
        cache: 'no-store' // Force bypass cache
      });
      
      console.log('📡 Response status:', response.status, response.statusText);
      console.log('📡 Content-Type:', response.headers.get('Content-Type'));
      
      if (!response.ok) {
        throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
      }
      
      const text = await response.text();
      console.log('📡 Raw response (first 500 chars):', text.substring(0, 500));
      
      let manifest;
      try {
        manifest = JSON.parse(text);
        console.log('📡 Parsed manifest:', {
          hasManifestVersion: !!manifest.manifestVersion,
          hasReleaseTag: !!manifest.releaseTag,
          hasCreatedAt: !!manifest.createdAt,
          hasPacks: !!manifest.packs,
          packCount: manifest.packs?.length
        });
      } catch (parseError) {
        console.error('📡 JSON parse failed:', parseError);
        throw new Error(`Failed to parse manifest JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
      
      if (!validateManifest(manifest)) {
        console.error('📡 Manifest validation failed. Manifest object:', manifest);
        throw new Error('Invalid manifest format');
      }
      
      // Validate manifest signature if present
      if (manifest.manifestSignature) {
        // TODO: Implement Ed25519 signature verification
        // For now, we'll skip this but it should be implemented for production
      }
      
      this.manifest = manifest;
      return manifest;
      
    } catch (error) {
      throw new Error(`Manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Download a pack with retry logic and streaming
   */
  async downloadPack(packId: string): Promise<Uint8Array> {
    if (!this.manifest) {
      await this.fetchManifest();
    }
    
    const pack = this.manifest!.packs.find(p => p.id === packId);
    
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }
    
    // Check compatibility
    if (!isPackCompatible(pack, this.options.appVersion)) {
      throw new Error(`Pack ${packId} requires app version ${pack.minAppVersion} or higher`);
    }
    
    // Check if pack is already cached
    await this.initDB();
    const cached = await this.getCachedPack(packId, pack.version, pack.sha256);
    
    if (cached) {
      console.log(`✓ Using cached pack: ${packId}`);
      this.options.onProgress({
        packId,
        loaded: pack.size,
        total: pack.size,
        percentage: 100,
        stage: 'complete'
      });
      return cached;
    }
    
    // Download with retries
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        console.log(`Downloading ${packId} (attempt ${attempt}/${this.options.maxRetries})...`);
        
        const data = await this.downloadWithProgress(pack);
        
        // Validate SHA-256
        this.options.onProgress({
          packId,
          loaded: pack.size,
          total: pack.size,
          percentage: 100,
          stage: 'validating'
        });
        
        await this.validateSHA256(data, pack.sha256);
        
        // Cache the pack
        this.options.onProgress({
          packId,
          loaded: pack.size,
          total: pack.size,
          percentage: 100,
          stage: 'caching'
        });
        
        await this.cachePack(packId, pack.version, pack.sha256, data);
        
        this.options.onProgress({
          packId,
          loaded: pack.size,
          total: pack.size,
          percentage: 100,
          stage: 'complete'
        });
        
        return data;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Download attempt ${attempt} failed:`, lastError.message);

        // A content mismatch means the server is serving a different file than
        // the manifest describes -- usually a stale release asset. Retrying
        // fetches the same wrong bytes again, so three attempts just burn the
        // user's data (three 46 MB downloads, in the case that prompted this)
        // before reporting a problem no retry could fix.
        if ((lastError as PackContentError).isContentMismatch) {
          throw lastError;
        }

        // Wait before retrying (exponential backoff)
        if (attempt < this.options.maxRetries) {
          const delay = this.options.retryDelay * Math.pow(2, attempt - 1);
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`Failed to download ${packId} after ${this.options.maxRetries} attempts: ${lastError?.message}`);
  }
  
  /**
   * Download with progress tracking using ReadableStream
   */
  private async downloadWithProgress(pack: PackEntry): Promise<Uint8Array> {
    const response = await fetch(pack.downloadUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : pack.size;
    
    if (!response.body) {
      throw new Error('ReadableStream not supported');
    }
    
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks.push(value);
      loaded += value.length;
      
      this.options.onProgress({
        packId: pack.id,
        loaded,
        total,
        percentage: Math.round((loaded / total) * 100),
        stage: 'downloading'
      });
    }
    
    // A short read is a broken transfer and worth retrying. Receiving MORE
    // than expected is not "partial" at all -- it means the file on the server
    // is not the file the manifest describes, and no retry will change that.
    if (loaded < total) {
      throw new Error(
        `Partial download of ${pack.id}: expected ${total} bytes, got ${loaded}`,
      );
    }
    if (loaded > total) {
      throw contentMismatch(
        `${pack.id} on the server does not match the manifest: expected ` +
          `${total} bytes, got ${loaded}. The published pack is probably out ` +
          `of date -- re-upload it, or regenerate the manifest.`,
      );
    }
    
    // Concatenate chunks
    const data = new Uint8Array(loaded);
    let offset = 0;
    
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    
    return data;
  }
  
  /**
   * Validate SHA-256 hash
   */
  private async validateSHA256(data: Uint8Array, expectedHash: string): Promise<void> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    if (hashHex !== expectedHash.toLowerCase()) {
      throw contentMismatch(
        `SHA-256 mismatch: expected ${expectedHash}, got ${hashHex}`,
      );
    }
  }
  
  /**
   * Cache pack in IndexedDB
   */
  private async cachePack(packId: string, version: string, sha256: string, data: Uint8Array): Promise<void> {
    await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pack_files'], 'readwrite');
      const store = transaction.objectStore('pack_files');

      const request = store.put({
        id: packId,
        version,
        // What the bytes actually are, so a rebuilt pack is recognised as
        // different even when it kept its version number.
        sha256,
        data,
        cachedAt: Date.now()
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Get cached pack
   */
  private async getCachedPack(
    packId: string,
    version: string,
    sha256: string,
  ): Promise<Uint8Array | null> {
    await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pack_files'], 'readonly');
      const store = transaction.objectStore('pack_files');

      const request = store.get(packId);

      request.onsuccess = () => {
        const cached = request.result;

        if (!cached) {
          resolve(null);
          return;
        }

        // Check version match
        if (cached.version !== version) {
          console.log(`Cached pack ${packId} version mismatch (${cached.version} vs ${version})`);
          resolve(null);
          return;
        }

        // Then the checksum, which is the pack's real identity. Versions are
        // deliberately held steady across rebuilds, so a version match alone
        // would replay stale bytes forever and no corrected pack could ever
        // reach the app. Blobs cached before this check carry no checksum and
        // are treated as stale, which clears them out on the next install.
        if (cached.sha256 !== sha256) {
          console.log(
            `Cached pack ${packId} is stale (${cached.sha256 ?? 'no checksum'} vs ${sha256}) — re-downloading`,
          );
          resolve(null);
          return;
        }

        resolve(cached.data);
      };

      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Install a pack (download + extract to IndexedDB)
   */
  async installPack(packId: string): Promise<void> {
    console.log(`Installing pack: ${packId}`);
    
    // Download pack
    const data = await this.downloadPack(packId);
    
    // Extract to IndexedDB
    this.options.onProgress({
      packId,
      loaded: data.length,
      total: data.length,
      percentage: 100,
      stage: 'extracting'
    });
    
    const pack = this.manifest!.packs.find(p => p.id === packId)!;
    
    // Open in SQLite worker
    await sqliteWorker.openDatabase(packId, data);
    
    // Extract data based on pack type
    const extractedData = await sqliteWorker.extractPack(packId, pack.type);
    
    // Store extracted data in app's IndexedDB
    // (This would integrate with existing databaseService)
    // For now, we'll just close the pack
    await sqliteWorker.closeDatabase(packId);
    
    console.log(`✅ Pack installed: ${packId}`);
  }
  
  /**
   * Remove a cached pack
   */
  async removeCachedPack(packId: string): Promise<void> {
    await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pack_files'], 'readwrite');
      const store = transaction.objectStore('pack_files');
      
      const request = store.delete(packId);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Get list of installed packs
   */
  async getInstalledPacks(): Promise<string[]> {
    await this.initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['pack_files'], 'readonly');
      const store = transaction.objectStore('pack_files');
      
      const request = store.getAllKeys();
      
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Request persistent storage
   */
  async requestPersistentStorage(): Promise<boolean> {
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      console.log(`Persistent storage: ${persisted ? 'granted' : 'denied'}`);
      return persisted;
    }
    return false;
  }
}
