export interface StorageServiceInterface {
  setItem(key: string, data: string);
  getItem(key: string): Promise<string>;
  removeItem(key: string);
  getAllItems(): Promise<string[]>;
  getAllKeys(): string[];
  removeAllItems();
}
