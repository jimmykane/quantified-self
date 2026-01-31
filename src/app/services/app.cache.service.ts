import { Injectable } from '@angular/core';
import { get, set, del, clear } from 'idb-keyval';

export interface CachedFile {
    buffer: ArrayBuffer;
    generation: string;
}

@Injectable({
    providedIn: 'root',
})
export class AppCacheService {

    constructor() { }

    public async getFile(key: string): Promise<CachedFile | undefined> {
        try {
            return await get<CachedFile>(key);
        } catch (e) {
            console.warn('[AppCacheService] Failed to get file from cache', e);
            return undefined;
        }
    }

    public async setFile(key: string, value: CachedFile): Promise<void> {
        try {
            await set(key, value);
        } catch (e) {
            console.warn('[AppCacheService] Failed to set file in cache', e);
        }
    }

    public async removeFile(key: string): Promise<void> {
        try {
            await del(key);
        } catch (e) {
            console.warn('[AppCacheService] Failed to remove file from cache', e);
        }
    }

    public async clearCache(): Promise<void> {
        try {
            await clear();
        } catch (e) {
            console.warn('[AppCacheService] Failed to clear cache', e);
        }
    }
}
