import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { AppWhatsNewService, ChangelogPost } from '../services/app.whats-new.service';
import { take, filter } from 'rxjs/operators';

export const releasesResolver: ResolveFn<ChangelogPost[]> = () => {
    const whatsNewService = inject(AppWhatsNewService);
    return whatsNewService.changelogs$.pipe(
        // Filter out initial empty value if we are waiting for data
        // However, if there are actually no logs, this might hang.
        // Better to just wait for the first emission since collectionData will emit at least once.
        take(1)
    );
};
