import { Component, inject, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppWhatsNewService, ChangelogPost } from '../../services/app.whats-new.service';
import { MaterialModule } from '../../modules/material.module';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { WhatsNewItemComponent } from './whats-new-item.component';

@Component({
    selector: 'app-whats-new-feed',
    standalone: true,
    imports: [CommonModule, MaterialModule, WhatsNewItemComponent],
    templateUrl: './whats-new-feed.component.html',
    styleUrls: ['./whats-new-feed.component.scss']
})
export class WhatsNewFeedComponent {
    private whatsNewService = inject(AppWhatsNewService);
    private router = inject(Router);
    private dialog = inject(MatDialog);

    public limit = input<number | null>(null);
    public displayMode = input<'compact' | 'full'>('full');

    public changelogs = computed(() => {
        const logs = this.whatsNewService.changelogs();
        const l = this.limit();
        return l ? logs.slice(0, l) : logs;
    });

    public isUnread(log: ChangelogPost): boolean {
        return this.whatsNewService.isUnread(log);
    }

    public navigateToReleases() {
        this.dialog.closeAll();
        this.router.navigate(['/releases']);
    }
}
