import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileActionsHeaderComponent } from './tile.actions.header.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { vi } from 'vitest';

describe('TileActionsHeaderComponent', () => {
    let component: TileActionsHeaderComponent;
    let fixture: ComponentFixture<TileActionsHeaderComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [TileActionsHeaderComponent],
            imports: [MatIconModule, MatButtonModule, MatTooltipModule]
        })
            .compileComponents();

        fixture = TestBed.createComponent(TileActionsHeaderComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should emit add event on button click', () => {
        const emitSpy = vi.spyOn(component.add, 'emit');
        const button = fixture.nativeElement.querySelector('button');
        button.click();
        expect(emitSpy).toHaveBeenCalled();
    });
});
