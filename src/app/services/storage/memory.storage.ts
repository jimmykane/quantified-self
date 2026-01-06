import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class MemoryStorage implements Storage {
    private data = new Map<string, string>();

    get length(): number {
        return this.data.size;
    }

    clear(): void {
        this.data.clear();
    }

    getItem(key: string): string | null {
        return this.data.get(key) || null;
    }

    key(index: number): string | null {
        return Array.from(this.data.keys())[index] || null;
    }

    removeItem(key: string): void {
        this.data.delete(key);
    }

    setItem(key: string, value: string): void {
        this.data.set(key, value);
    }

    // Not part of standard Storage interface, but useful helper if we need direct access
    keys(): string[] {
        return Array.from(this.data.keys());
    }
}
