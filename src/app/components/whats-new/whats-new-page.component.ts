import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppWhatsNewService } from '../../services/app.whats-new.service';
import { WhatsNewFeedComponent } from './whats-new-feed.component';

@Component({
    selector: 'app-whats-new-page',
    standalone: true,
    imports: [CommonModule, WhatsNewFeedComponent],
    template: `
    <div class="page-container">
      <h1 class="mat-headline-large page-title">Release Notes</h1>
      <app-whats-new-feed></app-whats-new-feed>
    </div>
  `,
    styles: [`
    .page-container {
      padding: 32px 16px;
      max-width: 900px;
      margin: 0 auto;
    }
    .page-title {
      text-align: center;
      margin-bottom: 32px;
    }
  `]
})
export class WhatsNewPageComponent implements OnInit {
    private whatsNewService = inject(AppWhatsNewService);

    ngOnInit() {
        this.whatsNewService.markAsRead();
    }
}
