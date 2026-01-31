import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChangelogPost } from '../../services/app.whats-new.service';
import { MaterialModule } from '../../modules/material.module';
import { MarkdownPipe } from '../../helpers/markdown.pipe';

@Component({
    selector: 'app-whats-new-item',
    standalone: true,
    imports: [CommonModule, MaterialModule, MarkdownPipe],
    templateUrl: './whats-new-item.component.html',
    styleUrls: ['./whats-new-item.component.scss']
})
export class WhatsNewItemComponent {
    public post = input.required<ChangelogPost>();
    public displayMode = input<'compact' | 'full'>('full');
    public isUnread = input<boolean>(false);
    public expanded = input<boolean>(false);

    public postClick = output<void>();

    public onCardClick() {
        if (this.displayMode() === 'compact') {
            this.postClick.emit();
        }
    }
}
