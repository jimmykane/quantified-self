export interface StorageServiceInterface {
  getNameSpace(): string;
  setItem(key: string, data: string);
  getItem(key: string): string;
  removeItem(key: string);
  getAllItems(): string[];
  getAllKeys(): string[];
  removeAllItems();
}
