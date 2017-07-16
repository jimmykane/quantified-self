import {Injectable} from '@angular/core';
import {StorageServiceInterface} from './app.storage.service.interface';
import * as LZString from 'lz-string';
import {Log} from 'ng2-logger';


@Injectable()
export class LocalStorageService implements StorageServiceInterface {

  private nameSpace = 'event.service';
  private logger = Log.create(this.constructor.name);

  constructor() {
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
      const t0 = performance.now();
      try {
        const decrypted = LZString.decompress(localStorage.getItem(this.nameSpace + key));
        this.logger.d('Decrypted 1 item after ' +
          (performance.now() - t0) + ' milliseconds or ' +
          (performance.now() - t0) / 1000 + ' seconds'
        );
        resolve(decrypted);
      } catch (Error) {
        // If not able to decode remove from storage
        console.error('Could not decode entry from local storage ' + key);
        localStorage.removeItem(key);
        reject(Error);
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
          items.push(LZString.decompress(localStorage.getItem(localStorageKey)));
        } catch (Error) {
          // If not able to decode remove from storage
          console.error('Could not decode entry from local storage ' + localStorageKey);
          localStorage.removeItem(localStorageKey);
        }
      });
      this.logger.d('Decrypted ' + items.length +  ' items from localStorage after ' +
          (performance.now() - t0) + ' milliseconds or ' +
          (performance.now() - t0) / 1000 + ' seconds'
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
