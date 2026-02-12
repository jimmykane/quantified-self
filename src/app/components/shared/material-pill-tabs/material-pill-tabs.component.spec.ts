import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatTabGroup } from '@angular/material/tabs';
import { MaterialModule } from '../../../modules/material.module';
import { MaterialPillTabDirective } from './material-pill-tab.directive';
import { MaterialPillTabsComponent } from './material-pill-tabs.component';

@Component({
  template: `
    <app-material-pill-tabs
      [selectedIndex]="selectedIndex"
      [density]="density"
      [lazyContent]="lazyContent"
      [stickyHeader]="stickyHeader"
      [topOffset]="topOffset"
      (selectedIndexChange)="onSelectedIndexChange($event)"
    >
      <ng-template appMaterialPillTab="One">
        <div id="content-one">One</div>
      </ng-template>
      <ng-template appMaterialPillTab="Two">
        <div id="content-two">Two</div>
      </ng-template>
    </app-material-pill-tabs>
  `,
  standalone: false,
})
class HostComponent {
  selectedIndex = 0;
  density: 'regular' | 'compact' = 'regular';
  lazyContent = true;
  stickyHeader = false;
  topOffset = '0px';

  onSelectedIndexChange(index: number) {
    this.selectedIndex = index;
  }
}

@Component({
  template: `
    <app-material-pill-tabs [selectedIndex]="selectedIndex">
      @if (showTabs) {
        <ng-template appMaterialPillTab="One">
          <div id="dynamic-content-one">One</div>
        </ng-template>
        <ng-template appMaterialPillTab="Two">
          <div id="dynamic-content-two">Two</div>
        </ng-template>
      }
    </app-material-pill-tabs>
  `,
  standalone: false,
})
class DynamicHostComponent {
  selectedIndex = 0;
  showTabs = false;
}

describe('MaterialPillTabsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MaterialModule, NoopAnimationsModule],
      declarations: [MaterialPillTabsComponent, MaterialPillTabDirective, HostComponent, DynamicHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should render projected tabs', () => {
    const tabButtons = fixture.nativeElement.querySelectorAll('[role="tab"]');

    expect(tabButtons.length).toBe(2);
    expect(tabButtons[0].textContent.trim()).toContain('One');
    expect(tabButtons[1].textContent.trim()).toContain('Two');
  });

  it('should forward selected index input', () => {
    host.selectedIndex = 1;
    fixture.detectChanges();
    const tabGroup = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    expect(tabGroup.selectedIndex).toBe(1);
  });

  it('should emit selectedIndexChange from native tabs', async () => {
    const tabButtons = fixture.nativeElement.querySelectorAll('[role="tab"]');
    tabButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.selectedIndex).toBe(1);
  });

  it('should apply compact density class', () => {
    host.density = 'compact';
    fixture.detectChanges();
    const tabGroup = fixture.debugElement.query(By.css('.material-pill-tabs'));
    expect(tabGroup.nativeElement.classList.contains('compact')).toBe(true);
  });

  it('should not enable sticky header by default', () => {
    const tabGroup = fixture.debugElement.query(By.css('.material-pill-tabs'));
    expect(tabGroup.nativeElement.classList.contains('sticky-header')).toBe(false);
  });

  it('should apply sticky header class and top offset variable', () => {
    host.stickyHeader = true;
    host.topOffset = '64px';
    fixture.detectChanges();

    const tabGroup = fixture.debugElement.query(By.css('.material-pill-tabs'));
    expect(tabGroup.nativeElement.classList.contains('sticky-header')).toBe(true);
    expect(tabGroup.nativeElement.style.getPropertyValue('--pill-tabs-sticky-top')).toBe('64px');
  });

  it('should keep native keyboard behavior smoke check', () => {
    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');
    tabs[0].focus();
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();
    expect(tabs.length).toBe(2);
  });

  it('should allow eager content mode', () => {
    host.lazyContent = false;
    fixture.detectChanges();
    const wrapper = fixture.debugElement.query(By.directive(MaterialPillTabsComponent)).componentInstance as MaterialPillTabsComponent;
    expect(wrapper.lazyContent).toBe(false);
    expect(fixture.nativeElement.querySelector('#content-one')).toBeTruthy();
  });

  it('should render projected tabs that are added dynamically', async () => {
    const dynamicFixture = TestBed.createComponent(DynamicHostComponent);
    dynamicFixture.detectChanges();

    let tabs = dynamicFixture.nativeElement.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(0);

    dynamicFixture.componentInstance.showTabs = true;
    dynamicFixture.detectChanges();
    await dynamicFixture.whenStable();
    dynamicFixture.detectChanges();

    tabs = dynamicFixture.nativeElement.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
  });
});
