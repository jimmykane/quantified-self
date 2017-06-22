import {Injectable} from '@angular/core';
import {StorageServiceInterface} from './app.storage.service.interface';
import * as LZString from 'lz-string';


@Injectable()
export class LocalStorageService implements StorageServiceInterface {

  private nameSpace: string;

  constructor() {}

  setNameSpace(nameSpace) {
    this.nameSpace = nameSpace;
  }

  setItem(key: string, data: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      localStorage.setItem(
        this.nameSpace + key,
        LZString.compress(data)
      );
      resolve(true);
    });
  }

  getItem(key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        resolve(LZString.decompress(localStorage.getItem(this.nameSpace + key)));
      } catch (Error) {
        // If not able to decode remove from storage
        console.error('Could not decode entry from local storage ' + key);
        localStorage.removeItem(key);
        reject(Error);
      }
    });
  }

  removeItem(key: string):  Promise<void> {
    return Promise.resolve(localStorage.removeItem(this.nameSpace + key));
  }

  getAllItems(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const items = [];
      this.getAllKeys().map((localStorageKey) => {
        // Try to decode
        try {
          items.push(LZString.decompress(localStorage.getItem(localStorageKey)));
        } catch (Error) {
          // If not able to decode remove from storage
          console.error('Could not decode entry from local storage ' + localStorageKey);
          localStorage.removeItem(localStorageKey);
        }
      });
      resolve(items);
    });
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
    for (const key of this.getAllKeys()){
      this.removeItem(key);
    }
  }
}
