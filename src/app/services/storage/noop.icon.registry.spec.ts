import { NoopIconRegistry } from './noop.icon.registry';
import { describe, it, expect, beforeEach } from 'vitest';
import { firstValueFrom } from 'rxjs';

describe('NoopIconRegistry', () => {
    let registry: NoopIconRegistry;

    beforeEach(() => {
        registry = new NoopIconRegistry();
    });

    it('should be created', () => {
        expect(registry).toBeTruthy();
    });

    it('should return itself on add methods for chaining', () => {
        expect(registry.addSvgIcon()).toBe(registry);
        expect(registry.addSvgIconInNamespace()).toBe(registry);
        expect(registry.addSvgIconLiteral()).toBe(registry);
        expect(registry.addSvgIconLiteralInNamespace()).toBe(registry);
    });

    it('should return an observable that emits undefined for getNamedSvgIcon', async () => {
        const result = await firstValueFrom(registry.getNamedSvgIcon());
        expect(result).toBeUndefined();
    });

    it('should return empty string or itself for font icon methods', () => {
        expect(registry.getDefaultFontIconClass()).toBe('');
        expect(registry.setDefaultFontIconClass()).toBe(registry);
    });
});
