import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { AppWhatsNewService, ChangelogPost } from '../services/app.whats-new.service';

export const releasesResolver: ResolveFn<ChangelogPost[]> = () => {
    const whatsNewService = inject(AppWhatsNewService);
    return whatsNewService.getChangelogsOnceLoaded();
};
