import { TestBed } from '@angular/core/testing';
import { LocalStorageService } from './app.local.storage.service';
import { APP_STORAGE } from './app.storage.token';
import { MemoryStorage } from './memory.storage';
import { Injectable } from '@angular/core';

// Concrete implementation for testing abstract class
@Injectable({ providedIn: 'root' })
class TestLocalStorageService extends LocalStorageService {
    protected nameSpace = 'test_namespace_';
}

describe('LocalStorageService', () => {
    let service: TestLocalStorageService;
    let storage: Storage;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                TestLocalStorageService,
                { provide: APP_STORAGE, useClass: MemoryStorage }
            ]
        });
        service = TestBed.inject(TestLocalStorageService);
        storage = TestBed.inject(APP_STORAGE);
    });

    afterEach(() => {
        storage.clear();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('setItem and getItem', () => {
        it('should set and get item with namespace', () => {
            service.setItem('key1', 'value1');
            expect(storage.getItem('test_namespace_key1')).toBe('value1');
            expect(service.getItem('key1')).toBe('value1');
        });

        it('should return empty string for non-existent item', () => {
            expect(service.getItem('nonexistent')).toBe('');
        });
    });

    describe('removeItem', () => {
        it('should remove item', () => {
            service.setItem('key1', 'value1');
            service.removeItem('key1');
            expect(service.getItem('key1')).toBe('');
            expect(storage.getItem('test_namespace_key1')).toBeNull();
        });
    });

    describe('getAllKeys', () => {
        it('should return only keys with correct namespace', () => {
            service.setItem('key1', 'value1');
            service.setItem('key2', 'value2');
            storage.setItem('other_namespace_key3', 'value3'); // Should be ignored

            const keys = service.getAllKeys();
            expect(keys).toContain('key1');
            expect(keys).toContain('key2');
            expect(keys).not.toContain('key3');
            expect(keys.length).toBe(2);
        });
    });

    describe('getAllItems', () => {
        it('should return all items for the namespace', () => {
            service.setItem('key1', 'value1');
            service.setItem('key2', 'value2');
            storage.setItem('other_namespace_key3', 'value3');

            const items = service.getAllItems();
            expect(items).toContain('value1');
            expect(items).toContain('value2');
            expect(items).not.toContain('value3');
            expect(items.length).toBe(2);
        });
    });

    describe('removeAllItems', () => {
        it('should remove all items with namespace', () => {
            service.setItem('key1', 'value1');
            service.setItem('key2', 'value2');
            storage.setItem('other_namespace_key3', 'value3');

            service.removeAllItems();
            expect(service.getItem('key1')).toBe('');
            expect(service.getItem('key2')).toBe('');
            expect(storage.getItem('other_namespace_key3')).toBe('value3'); // Should persist
        });
    });

    describe('clearAllStorage', () => {
        it('should clear everything in storage', () => {
            service.setItem('key1', 'value1');
            storage.setItem('other_namespace_key3', 'value3');

            service.clearAllStorage();
            expect(service.getItem('key1')).toBe('');
            expect(storage.getItem('other_namespace_key3')).toBeNull();
        });
    });
});
