import {Log, Logger} from 'ng2-logger';

export interface StorageServiceInterface {
  getNameSpace(): string;
  setItem(key: string, data: string);
  getItem(key: string): Promise<string>;
  removeItem(key: string);
  getAllItems(): Promise<string[]>;
  getAllKeys(): string[];
  removeAllItems();
}
