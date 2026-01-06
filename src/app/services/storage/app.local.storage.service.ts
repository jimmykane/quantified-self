import { StorageServiceInterface } from './app.storage.service.interface';
import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';


@Injectable({
  providedIn: 'root',
})
export abstract class LocalStorageService implements StorageServiceInterface {

  protected abstract nameSpace: string;

  private localStorage: Storage | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.localStorage = localStorage;
    }
  }

  getNameSpace(): string {
    return this.nameSpace;
  }

  setItem(key: string, data: string) {
    if (!this.localStorage) return;
    this.localStorage.setItem(
      this.nameSpace + key,
      data,
    );
  }

  getItem(key: string): string {
    if (!this.localStorage) return null as any; // or return ''
    return this.localStorage.getItem(this.nameSpace + key) || '';
  }

  removeItem(key: string): void {
    if (!this.localStorage) return;
    return this.localStorage.removeItem(this.nameSpace + key)
  }

  getAllItems(): string[] {
    if (!this.localStorage) return [];
    const items: string[] = [];
    this.getAllKeys().map((localStorageKey) => {
      const item = this.localStorage!.getItem(localStorageKey);
      if (item) items.push(item);
    });
    return items;
  }

  getAllKeys(): string[] {
    if (!this.localStorage) return [];
    const localStorageKeys: string[] = [];
    Object.keys(this.localStorage).map((localStorageKey) => {
      // If not in the correct namespace move on
      if (localStorageKey.startsWith(this.nameSpace)) {
        localStorageKeys.push(localStorageKey.slice(this.nameSpace.length));
      }
    });
    return localStorageKeys;
  }

  removeAllItems() {
    for (const key of this.getAllKeys()) {
      this.removeItem(key);
    }
  }

  clearAllStorage() {
    if (!this.localStorage) return;
    this.localStorage.clear();
  }
}
