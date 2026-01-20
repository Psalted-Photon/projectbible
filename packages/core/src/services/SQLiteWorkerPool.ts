/**
 * SQLite Worker Pool Manager
 * 
 * Manages the single global SQLite worker and provides a clean API
 * for interacting with SQLite databases.
 * 
 * Usage:
 *   const pool = SQLiteWorkerPool.getInstance();
 *   await pool.openDatabase('mydb', uint8Array);
 *   const results = await pool.query('mydb', 'SELECT * FROM table');
 *   await pool.closeDatabase('mydb');
 */

import type { WorkerMessage, WorkerResponse } from './SQLiteWorker';

export class SQLiteWorkerPool {
  private static instance: SQLiteWorkerPool;
  private worker: Worker | null = null;
  private messageId = 0;
  private pendingMessages = new Map<string, {
    resolve: (data: any) => void;
    reject: (error: Error) => void;
  }>();
  
  private constructor() {}
  
  static getInstance(): SQLiteWorkerPool {
    if (!SQLiteWorkerPool.instance) {
      SQLiteWorkerPool.instance = new SQLiteWorkerPool();
    }
    return SQLiteWorkerPool.instance;
  }
  
  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    if (this.worker) return; // Already initialized
    
    // Create worker
    this.worker = new Worker(
      new URL('./SQLiteWorker.ts', import.meta.url),
      { type: 'module' }
    );
    
    // Set up message handler
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, success, data, error } = e.data;
      const pending = this.pendingMessages.get(id);
      
      if (pending) {
        this.pendingMessages.delete(id);
        
        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error || 'Unknown worker error'));
        }
      }
    };
    
    // Initialize sql.js in worker
    await this.sendMessage('init', {});
  }
  
  /**
   * Send a message to the worker
   */
  private sendMessage(action: WorkerMessage['action'], data: any, dbId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }
      
      const id = `msg-${++this.messageId}`;
      
      this.pendingMessages.set(id, { resolve, reject });
      
      const message: WorkerMessage = {
        id,
        action,
        dbId,
        data
      };
      
      this.worker.postMessage(message);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error('Worker message timeout'));
        }
      }, 30000);
    });
  }
  
  /**
   * Open a database
   */
  async openDatabase(dbId: string, data?: Uint8Array): Promise<void> {
    await this.initialize();
    await this.sendMessage('open', data, dbId);
  }
  
  /**
   * Execute a query and return results
   */
  async query(dbId: string, sql: string, params?: any[]): Promise<any[]> {
    await this.initialize();
    return await this.sendMessage('query', { sql, params }, dbId);
  }
  
  /**
   * Execute SQL without returning results
   */
  async exec(dbId: string, sql: string): Promise<void> {
    await this.initialize();
    await this.sendMessage('exec', { sql }, dbId);
  }
  
  /**
   * Close a database
   */
  async closeDatabase(dbId: string): Promise<void> {
    await this.sendMessage('close', {}, dbId);
  }
  
  /**
   * Extract pack data for IndexedDB storage
   */
  async extractPack(dbId: string, packType: string): Promise<any> {
    await this.initialize();
    return await this.sendMessage('extractPack', { packType }, dbId);
  }
  
  /**
   * Terminate the worker (cleanup)
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingMessages.clear();
  }
}

// Export singleton instance
export const sqliteWorker = SQLiteWorkerPool.getInstance();
