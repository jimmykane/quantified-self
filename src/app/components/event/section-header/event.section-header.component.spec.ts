import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { EventSectionHeaderComponent } from './event.section-header.component';

@Component({
    template: `
    <app-event-section-header icon="map" title="Laps">
      <button class="projected-action">Options</button>
    </app-event-section-header>
  `,
    standalone: false
})
class HostComponent {
}

describe('EventSectionHeaderComponent', () => {
    let fixture: ComponentFixture<HostComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [HostComponent, EventSectionHeaderComponent],
            imports: [MatIconModule],
        }).compileComponents();

        fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
    });

    it('should render icon', () => {
        const iconEl: HTMLElement | null = fixture.nativeElement.querySelector('mat-icon');
        expect(iconEl?.textContent?.trim()).toBe('map');
    });

    it('should render title when provided', () => {
        const titleEl: HTMLElement | null = fixture.nativeElement.querySelector('.event-section-header-title');
        expect(titleEl?.textContent?.trim()).toBe('Laps');
    });

    it('should project actions content', () => {
        const projectedAction: HTMLButtonElement | null = fixture.nativeElement.querySelector('.projected-action');
        expect(projectedAction).toBeTruthy();
        expect(projectedAction?.textContent?.trim()).toBe('Options');
    });
});
