import {Injectable} from '@angular/core';
import {StorageServiceInterface} from './app.storage.service.interface';
import * as LZString from 'lz-string';
import {Log} from 'ng2-logger/client';


@Injectable()
export abstract class LocalStorageService implements StorageServiceInterface {

  protected nameSpace = 'quantified-self';
  protected logger = Log.create('LocalStorageService');

  constructor() {
  }

  setItem(key: string, data: string) {
    localStorage.setItem(
      this.nameSpace + key,
      LZString.compressToUTF16(data),
    );
  }

  getItem(key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      try {
        const decrypted = LZString.decompressFromUTF16(localStorage.getItem(this.nameSpace + key));
        this.logger.d('Decrypted 1 item after ' +
          (performance.now() - t0) + ' milliseconds or ' +
          (performance.now() - t0) / 1000 + ' seconds',
        );
        resolve(decrypted);
      } catch (e) {
        // If not able to decode remove from storage
        console.error('Could not decode entry from local storage ' + key);
        localStorage.removeItem(key);
        reject(e);
      }
    });
  }

  removeItem(key: string): Promise<void> {
    return Promise.resolve(localStorage.removeItem(this.nameSpace + key));
  }

  getAllItems(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const items = [];
      this.getAllKeys().map((localStorageKey) => {
        // Try to decode
        try {
          items.push(LZString.decompressFromUTF16(localStorage.getItem(localStorageKey)));
        } catch (Error) {
          // If not able to decode remove from storage
          console.error('Could not decode entry from local storage ' + localStorageKey);
          localStorage.removeItem(localStorageKey);
        }
      });
      this.logger.d('Decrypted ' + items.length + ' items from localStorage after ' +
        (performance.now() - t0) + ' milliseconds or ' +
        (performance.now() - t0) / 1000 + ' seconds',
      );
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
    for (const key of this.getAllKeys()) {
      this.removeItem(key);
    }
  }
}
