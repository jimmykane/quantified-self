import {StorageServiceInterface} from './app.storage.service.interface';
import {Log, Logger} from 'ng2-logger/client';


export abstract class LocalStorageService implements StorageServiceInterface {

  protected abstract nameSpace: string;
  protected abstract logger: Logger<{}>;

  constructor() {
  }

  getLogger(): Logger<{}>{
    return this.logger;
  }

  getNameSpace(): string{
    return this.nameSpace;
  }

  setItem(key: string, data: string) {
    localStorage.setItem(
      this.nameSpace + key,
      data,
    );
  }

  getItem(key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!localStorage.getItem(this.nameSpace + key)){
        reject('No item found');
        return;
      }
      resolve(localStorage.getItem(this.nameSpace + key));
    });
  }

  removeItem(key: string): Promise<void> {
    return Promise.resolve(localStorage.removeItem(this.nameSpace + key));
  }

  getAllItems(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const items = [];
      this.getAllKeys().map((localStorageKey) => {
          items.push(localStorage.getItem(localStorageKey));
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
    for (const key of this.getAllKeys()) {
      this.removeItem(key);
    }
  }
}
