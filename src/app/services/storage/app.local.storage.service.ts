import {StorageServiceInterface} from './app.storage.service.interface';
import {Logger} from 'ng2-logger/browser';
import { Injectable } from "@angular/core";


@Injectable()
export abstract class LocalStorageService implements StorageServiceInterface {

  protected abstract nameSpace: string;
  protected abstract logger: Logger<{}>;

  constructor() {
  }

  getNameSpace(): string {
    return this.nameSpace;
  }

  setItem(key: string, data: string) {
    localStorage.setItem(
      this.nameSpace + key,
      data,
    );
  }

  getItem(key: string): string {
    return localStorage.getItem(this.nameSpace + key)
  }

  removeItem(key: string): void {
    return localStorage.removeItem(this.nameSpace + key)
  }

  getAllItems(): string[] {
      const items = [];
      this.getAllKeys().map((localStorageKey) => {
        items.push(localStorage.getItem(localStorageKey));
      });
      return items;
  }

  getAllKeys(): string[] {
    const localStorageKeys = [];
    Object.keys(localStorage).map((localStorageKey) => {
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
}
