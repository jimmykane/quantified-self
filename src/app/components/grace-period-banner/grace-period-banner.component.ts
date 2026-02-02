import { Component, OnInit, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect, inject } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { AppUserService } from '../../services/app.user.service';
import { LoggerService } from '../../services/logger.service';

@Component({
    selector: 'app-grace-period-banner',
    templateUrl: './grace-period-banner.component.html',
    styleUrls: ['./grace-period-banner.component.scss'],
    standalone: false
})
export class GracePeriodBannerComponent implements OnInit, AfterViewInit, OnDestroy {
    @Output() heightChanged = new EventEmitter<number>();

    private _bannerElement: ElementRef<HTMLDivElement> | undefined;

    @ViewChild('bannerElement')
    set bannerElement(element: ElementRef<HTMLDivElement> | undefined) {
        this._bannerElement = element;
        if (element) {
            this.logger.info('[GracePeriodBanner] ViewChild setter called - Element present');
            this.updateHeight();
        } else {
            this.logger.info('[GracePeriodBanner] ViewChild setter called - Element undefined');
        }
    }

    get bannerElement(): ElementRef<HTMLDivElement> | undefined {
        return this._bannerElement;
    }

    private userService = inject(AppUserService);
    private logger = inject(LoggerService);

    gracePeriodUntil = this.userService.gracePeriodUntil;
    isDismissed = false;
    private subscription: Subscription | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor() {
        effect(() => {
            const date = this.gracePeriodUntil();
            this.logger.info('[GracePeriodBanner] Effect triggered - gracePeriodUntil:', date);
            // Use setTimeout to ensure the DOM is updated before measuring
            setTimeout(() => {
                this.updateHeight();
                this.setupResizeObserver();
            }, 0);
        });
    }

    ngOnInit(): void {
        this.logger.info('[GracePeriodBanner] ngOnInit - Signal already initialized in service');
    }

    ngAfterViewInit(): void {
        // Use an effect or similar to update height when signal changes
        // Since we are in EXECUTION and the component might be simple, 
        // using effect() in constructor is cleaner for signals.
        // But for this refactor, I'll just change the subscription to an effect-like behavior if needed.
        // Actually, let's use effect in the constructor for the height update.
    }

    ngOnDestroy(): void {
        this.subscription?.unsubscribe();
        this.resizeObserver?.disconnect();
    }

    dismiss(): void {
        this.isDismissed = true;
        this.heightChanged.emit(0);
        this.resizeObserver?.disconnect();
    }

    private setupResizeObserver(): void {
        this.resizeObserver?.disconnect(); // Disconnect existing if any

        if (this.bannerElement?.nativeElement) {
            this.resizeObserver = new ResizeObserver(() => {
                this.updateHeight();
            });
            this.resizeObserver.observe(this.bannerElement.nativeElement);
        }
    }

    private updateHeight(): void {
        if (this._bannerElement && !this.isDismissed) {
            const height = this._bannerElement.nativeElement.offsetHeight;
            this.logger.info('[GracePeriodBanner] updateHeight - emitting height:', height);
            this.heightChanged.emit(height);
        } else {
            this.logger.info('[GracePeriodBanner] updateHeight - emitting 0');
            this.heightChanged.emit(0);
        }
    }
}
