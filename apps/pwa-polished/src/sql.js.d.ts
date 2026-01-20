// Type declarations for sql.js
declare module 'sql.js' {
  export interface Database {
    run(sql: string, params?: any[]): void;
    exec(sql: string): any[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    get(params?: any[]): any[];
    getAsObject(params?: any[]): any;
    free(): void;
  }

  export interface SqlJsStatic {
    Database: {
      new (data?: ArrayBuffer | Uint8Array | null): Database;
    };
  }

  export interface InitSqlJsOptions {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
