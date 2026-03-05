import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { RouterModule } from '@angular/router';
import { SafeHtml } from '@angular/platform-browser';
import { MaterialModule } from '../../modules/material.module';
import { MarkdownPipe } from '../../helpers/markdown.pipe';
import { HELP_ACTIONS, HELP_SECTIONS, HelpSection, HelpSectionId } from '../../shared/help.content';

@Component({
  selector: 'app-help-page',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  providers: [MarkdownPipe],
  templateUrl: './help-page.component.html',
  styleUrls: ['./help-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpPageComponent implements OnInit, OnDestroy {
  private document = inject(DOCUMENT);
  private changeDetectorRef = inject(ChangeDetectorRef);
  private breakpointObserver = inject(BreakpointObserver);
  private markdownPipe = inject(MarkdownPipe);
  private onHashChange = () => this.selectSectionFromHash();

  readonly actions = HELP_ACTIONS;
  readonly sections = HELP_SECTIONS;
  readonly renderedSectionContent: Partial<Record<HelpSectionId, SafeHtml>> = {};
  readonly isHandset = toSignal(
    this.breakpointObserver.observe([Breakpoints.XSmall, Breakpoints.Small]).pipe(map(result => result.matches)),
    { initialValue: false },
  );

  selectedSectionId: HelpSectionId = HELP_SECTIONS[0].id;

  get selectedSectionIndex(): number {
    return Math.max(
      0,
      this.sections.findIndex(section => section.id === this.selectedSectionId),
    );
  }

  get selectedSection(): HelpSection {
    return this.sections[this.selectedSectionIndex] ?? this.sections[0];
  }

  ngOnInit(): void {
    void this.preRenderSectionContent();
    this.selectSectionFromHash();
    this.document.defaultView?.addEventListener('hashchange', this.onHashChange, { passive: true });
  }

  ngOnDestroy() {
    this.document.defaultView?.removeEventListener('hashchange', this.onHashChange);
  }

  selectSectionFromNavigation(sectionId: HelpSectionId) {
    this.selectSection(sectionId, {
      updateHistory: true,
    });
  }

  onSectionTabChange(index: number) {
    const section = this.sections[index];
    if (!section) {
      return;
    }

    this.selectSectionFromNavigation(section.id);
  }

  onSectionSelect(sectionId: HelpSectionId) {
    this.selectSectionFromNavigation(sectionId);
  }

  private selectSectionFromHash() {
    const sectionId = this.document.location.hash.replace('#', '').trim();
    if (!this.isKnownSectionId(sectionId)) {
      return;
    }

    this.selectSection(sectionId, { updateHistory: false });
  }

  private selectSection(
    sectionId: HelpSectionId,
    options: {
      updateHistory: boolean;
    },
  ) {
    if (this.selectedSectionId !== sectionId) {
      this.selectedSectionId = sectionId;
      this.changeDetectorRef.markForCheck();
    }

    if (options.updateHistory) {
      this.setHistoryFragment(sectionId);
    }
  }

  private setHistoryFragment(sectionId: HelpSectionId) {
    const currentHash = this.document.location.hash.replace('#', '').trim();
    if (currentHash === sectionId) {
      return;
    }

    const pathWithQuery = `${this.document.location.pathname}${this.document.location.search}`;
    this.document.defaultView?.history.replaceState(null, '', `${pathWithQuery}#${sectionId}`);
  }

  private isKnownSectionId(sectionId: string): sectionId is HelpSectionId {
    return this.sections.some(section => section.id === sectionId);
  }

  private async preRenderSectionContent(): Promise<void> {
    const selectedSection = this.sections.find(section => section.id === this.selectedSectionId) ?? this.sections[0];
    this.renderedSectionContent[selectedSection.id] = await this.markdownPipe.transform(selectedSection.content);
    this.changeDetectorRef.markForCheck();

    const remainingSections = this.sections.filter(section => section.id !== selectedSection.id);
    const remainingRendered = await Promise.all(
      remainingSections.map(async (section) => ({ id: section.id, html: await this.markdownPipe.transform(section.content) })),
    );

    remainingRendered.forEach((rendered) => {
      this.renderedSectionContent[rendered.id] = rendered.html;
    });
    this.changeDetectorRef.markForCheck();
  }
}
