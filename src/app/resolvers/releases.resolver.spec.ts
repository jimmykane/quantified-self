import { TestBed } from '@angular/core/testing';
import { ResolveFn, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { of } from 'rxjs';
import { AppWhatsNewService, ChangelogPost } from '../services/app.whats-new.service';
import { releasesResolver } from './releases.resolver';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Timestamp } from '@angular/fire/firestore';

describe('releasesResolver', () => {
    const executeResolver: ResolveFn<ChangelogPost[]> = (...resolverParameters) =>
        TestBed.runInInjectionContext(() => releasesResolver(...resolverParameters));

    let whatsNewServiceSpy: any;

    const mockChangelogs: ChangelogPost[] = [
        {
            id: '1',
            title: 'v1.0.0',
            description: 'First release',
            date: Timestamp.now(),
            published: true,
            type: 'major'
        }
    ];

    beforeEach(() => {
        whatsNewServiceSpy = {
            changelogs$: of(mockChangelogs)
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: AppWhatsNewService, useValue: whatsNewServiceSpy }
            ]
        });
    });

    it('should be created', () => {
        expect(executeResolver).toBeTruthy();
    });

    it('should resolve with changelogs', () => new Promise<void>(done => {
        const route = new ActivatedRouteSnapshot();
        const state = {} as RouterStateSnapshot;

        (executeResolver(route, state) as any).subscribe((result: ChangelogPost[]) => {
            expect(result).toEqual(mockChangelogs);
            done();
        });
    }));
});
