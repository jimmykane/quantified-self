import { AfterViewInit, ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../modules/material.module';
import { MarkdownPipe } from '../../helpers/markdown.pipe';
import { HELP_ACTIONS, HELP_SECTIONS, HelpSectionId } from '../../shared/help.content';

@Component({
  selector: 'app-help-page',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule, MarkdownPipe],
  templateUrl: './help-page.component.html',
  styleUrls: ['./help-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpPageComponent implements AfterViewInit, OnDestroy {
  private document = inject(DOCUMENT);
  private onHashChange = () => this.scrollToCurrentHash('auto');

  readonly actions = HELP_ACTIONS;
  readonly sections = HELP_SECTIONS;

  ngAfterViewInit() {
    this.scrollToCurrentHash('auto');

    const view = this.document.defaultView;
    if (view && typeof view.requestAnimationFrame === 'function') {
      view.requestAnimationFrame(() => this.scrollToCurrentHash('auto'));
      view.addEventListener('hashchange', this.onHashChange, { passive: true });
    }
  }

  ngOnDestroy() {
    this.document.defaultView?.removeEventListener('hashchange', this.onHashChange);
  }

  scrollToSection(sectionId: HelpSectionId) {
    const section = this.document.getElementById(sectionId);
    if (!section) {
      return;
    }

    const pathWithQuery = `${this.document.location.pathname}${this.document.location.search}`;
    this.document.defaultView?.history.replaceState(null, '', `${pathWithQuery}#${sectionId}`);
    if (typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private scrollToCurrentHash(behavior: ScrollBehavior) {
    const sectionId = this.document.location.hash.replace('#', '').trim();
    if (!sectionId) {
      return;
    }

    const section = this.document.getElementById(sectionId);
    if (!section) {
      return;
    }

    if (typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ behavior, block: 'start' });
    }
  }
}
