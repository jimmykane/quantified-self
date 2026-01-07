import { StorageServiceInterface } from './app.storage.service.interface';
import { Injectable, Inject } from '@angular/core';
import { APP_STORAGE } from './app.storage.token';

@Injectable({
  providedIn: 'root',
})
export abstract class LocalStorageService implements StorageServiceInterface {

  protected abstract nameSpace: string;

  constructor(@Inject(APP_STORAGE) private storage: Storage) {
  }

  getNameSpace(): string {
    return this.nameSpace;
  }

  setItem(key: string, data: string) {
    this.storage.setItem(
      this.nameSpace + key,
      data,
    );
  }

  getItem(key: string): string {
    return this.storage.getItem(this.nameSpace + key) || '';
  }

  removeItem(key: string): void {
    this.storage.removeItem(this.nameSpace + key)
  }

  getAllItems(): string[] {
    const items: string[] = [];
    this.getAllKeys().map((localStorageKey) => {
      const item = this.storage.getItem(this.nameSpace + localStorageKey);
      if (item) items.push(item);
    });
    return items;
  }

  getAllKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(this.nameSpace)) {
        keys.push(key.slice(this.nameSpace.length));
      }
    }
    return keys;
  }

  removeAllItems() {
    for (const key of this.getAllKeys()) {
      this.removeItem(key);
    }
  }

  clearAllStorage() {
    this.storage.clear();
  }
}
