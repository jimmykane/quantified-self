import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { RouterModule } from '@angular/router';
import { SafeHtml } from '@angular/platform-browser';
import { MaterialModule } from '../../modules/material.module';
import { MarkdownPipe } from '../../helpers/markdown.pipe';
import { searchHelpSections } from '../../helpers/help-search.helper';
import { HELP_ACTIONS, HELP_SECTIONS, HelpAction, HelpSection, HelpSectionId } from '../../shared/help.content';

interface HelpActionCard extends HelpAction {
  description: string;
}

const HELP_ACTION_DESCRIPTIONS: Record<HelpAction['id'], string> = {
  'email-support': 'Get in touch when you need personal help.',
  'report-bug': 'Share a reproducible problem with the product.',
  'release-notes': 'See recent fixes, improvements, and changes.',
  policies: 'Review data, privacy, and account policies.',
};

const POPULAR_SECTION_IDS: readonly HelpSectionId[] = [
  'service-connections',
  'uploads-and-imports',
  'ai-insights',
  'troubleshooting',
];

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
  private breakpointObserver = inject(BreakpointObserver);
  private markdownPipe = inject(MarkdownPipe);
  private onHashChange = () => this.selectSectionFromHash();

  readonly sections = HELP_SECTIONS;
  readonly actions: readonly HelpActionCard[] = HELP_ACTIONS.map(action => ({
    ...action,
    description: HELP_ACTION_DESCRIPTIONS[action.id],
  }));
  readonly renderedSectionContent = signal<Partial<Record<HelpSectionId, SafeHtml>>>({});
  readonly isHandset = toSignal(
    this.breakpointObserver.observe([Breakpoints.XSmall, Breakpoints.Small]).pipe(map(result => result.matches)),
    { initialValue: false },
  );
  readonly searchQuery = signal('');
  readonly selectedSectionId = signal<HelpSectionId | null>(null);
  readonly hasSearchQuery = computed(() => this.searchQuery().trim().length > 0);
  readonly searchResults = computed(() => searchHelpSections(this.sections, this.searchQuery()));
  readonly isArticleOpen = computed(() => this.selectedSectionId() !== null);
  readonly selectedSection = computed<HelpSection>(() => {
    const sectionId = this.selectedSectionId();
    return this.sections.find(section => section.id === sectionId) ?? this.sections[0];
  });
  readonly popularSections = computed(() =>
    POPULAR_SECTION_IDS
      .map(sectionId => this.sections.find(section => section.id === sectionId))
      .filter((section): section is HelpSection => Boolean(section)),
  );

  ngOnInit(): void {
    void this.preRenderSectionContent();
    this.selectSectionFromHash();
    this.document.defaultView?.addEventListener('hashchange', this.onHashChange, { passive: true });
  }

  ngOnDestroy() {
    this.document.defaultView?.removeEventListener('hashchange', this.onHashChange);
  }

  openSection(sectionId: HelpSectionId): void {
    this.searchQuery.set('');
    this.selectSection(sectionId, true);
  }

  returnToHelpCenter(): void {
    this.searchQuery.set('');
    this.selectedSectionId.set(null);
    this.setHistoryFragment(null);
  }

  onSearchQueryChange(query: string): void {
    this.searchQuery.set(query);
    if (query.trim()) {
      this.selectedSectionId.set(null);
      this.setHistoryFragment(null);
    }
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  private selectSectionFromHash(): void {
    const sectionId = this.document.location.hash.replace('#', '').trim();
    if (!this.isKnownSectionId(sectionId)) {
      this.selectedSectionId.set(null);
      return;
    }

    this.selectSection(sectionId, false);
  }

  private selectSection(sectionId: HelpSectionId, updateHistory: boolean): void {
    this.selectedSectionId.set(sectionId);
    if (updateHistory) {
      this.setHistoryFragment(sectionId);
    }
  }

  private setHistoryFragment(sectionId: HelpSectionId | null): void {
    const currentHash = this.document.location.hash.replace('#', '').trim();
    const nextHash = sectionId ?? '';
    if (currentHash === nextHash) {
      return;
    }

    const pathWithQuery = `${this.document.location.pathname}${this.document.location.search}`;
    const nextUrl = sectionId ? `${pathWithQuery}#${sectionId}` : pathWithQuery;
    this.document.defaultView?.history.replaceState(null, '', nextUrl);
  }

  private isKnownSectionId(sectionId: string): sectionId is HelpSectionId {
    return this.sections.some(section => section.id === sectionId);
  }

  private async preRenderSectionContent(): Promise<void> {
    const renderedSections = await Promise.all(
      this.sections.map(async section => ({
        id: section.id,
        html: await this.markdownPipe.transform(section.content),
      })),
    );

    this.renderedSectionContent.set(
      renderedSections.reduce<Partial<Record<HelpSectionId, SafeHtml>>>((content, rendered) => ({
        ...content,
        [rendered.id]: rendered.html,
      }), {}),
    );
  }
}
