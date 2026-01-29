import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TileActionsFooterComponent } from './tile.actions.footer.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { vi } from 'vitest';

describe('TileActionsFooterComponent', () => {
    let component: TileActionsFooterComponent;
    let fixture: ComponentFixture<TileActionsFooterComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [TileActionsFooterComponent],
            imports: [MatIconModule, MatButtonModule]
        })
            .compileComponents();

        fixture = TestBed.createComponent(TileActionsFooterComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should emit delete event on button click', () => {
        const emitSpy = vi.spyOn(component.delete, 'emit');
        const button = fixture.nativeElement.querySelector('button');
        button.click();
        expect(emitSpy).toHaveBeenCalled();
    });
});
