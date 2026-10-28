import { ChangeDetectionStrategy, Component, ElementRef, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { renderAssistantMarkdown } from '../../helpers/assistant-message-format.helper';
import { AppHapticsService } from '../../services/app.haptics.service';

@Component({
  selector: 'app-assistant-message-body',
  standalone: true,
  templateUrl: './assistant-message-body.component.html',
  styleUrl: './assistant-message-body.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Delegated native anchor clicks also cover keyboard activation of Markdown links.
  host: { '(click)': 'onBodyClick($event)' },
  // innerHTML descendants do not receive Angular's emulated attributes. Every rule
  // is scoped to our own host/body; model HTML still passes Angular's sanitizer.
  encapsulation: ViewEncapsulation.None,
})
export class AssistantMessageBodyComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly haptics = inject(AppHapticsService);
  readonly text = input.required<string>();
  readonly html = computed(() => renderAssistantMarkdown(this.text()));

  onBodyClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (link && this.element.nativeElement.contains(link)) this.haptics.selection();
  }
}
