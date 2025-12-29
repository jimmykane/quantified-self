import { Component, OnInit, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { AppUserService } from '../../services/app.user.service';

@Component({
    selector: 'app-grace-period-banner',
    templateUrl: './grace-period-banner.component.html',
    styleUrls: ['./grace-period-banner.component.scss'],
    standalone: false
})
export class GracePeriodBannerComponent implements OnInit, AfterViewInit, OnDestroy {
    @Output() heightChanged = new EventEmitter<number>();
    @ViewChild('bannerElement') bannerElement: ElementRef<HTMLDivElement> | undefined;

    gracePeriodUntil$!: Observable<Date | null>;
    isDismissed = false;
    private subscription: Subscription | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(private userService: AppUserService) { }

    ngOnInit(): void {
        this.gracePeriodUntil$ = this.userService.getGracePeriodUntil();
    }

    ngAfterViewInit(): void {
        // Subscribe to grace period changes to update height when banner appears
        this.subscription = this.gracePeriodUntil$.subscribe(() => {
            // Use setTimeout to ensure the DOM is updated before measuring
            setTimeout(() => {
                this.updateHeight();
                this.setupResizeObserver();
            }, 0);
        });
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
        if (this.bannerElement && !this.isDismissed) {
            this.heightChanged.emit(this.bannerElement.nativeElement.offsetHeight);
        } else {
            this.heightChanged.emit(0);
        }
    }
}
