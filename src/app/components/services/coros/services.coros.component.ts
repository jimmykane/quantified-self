import { Component, Input } from '@angular/core';
import { ServiceNames, UserServiceMetaInterface } from '@sports-alliance/sports-lib';
import { ServiceConnectionAccountProjection } from '@shared/service-connection';
import { HttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import { AppFileService } from '../../../services/app.file.service';
import { AppEventService } from '../../../services/app.event.service';
import { AppAuthService } from '../../../authentication/app.auth.service';
import { AppUserService } from '../../../services/app.user.service';
import { AppWindowService } from '../../../services/app.window.service';
import { ServicesAbstractComponentDirective } from '../services-abstract-component.directive';
import { COROS_HISTORY_IMPORT_LIMIT_MONTHS } from '../../../constants/coros';
import { ACTIVITY_SYNC_ROUTE_IDS } from '@shared/activity-sync-routes';
import { isActivitySyncRouteUIDAllowlisted } from '@shared/activity-sync-rollout';
import dayjs from 'dayjs';
import { Subscription } from 'rxjs';
import {
  buildSuuntoServiceConnectionViewModel,
  SuuntoServiceConnectionViewModel,
} from '../../../helpers/suunto-service-connection.helper';
import {
  isDisconnectPendingServiceConnection,
  isReconnectRequiredServiceConnection,
} from '@shared/service-connection';
import { isCOROSRouteUploadUIDAllowlisted } from '@shared/coros-rollout';

const COROS_BINDING_STATE_STALE_RETRY_FALLBACK_MS = 15_000;

type COROSConnectionAccountLike = ServiceConnectionAccountProjection & {
  openId?: string;
  dateCreated?: string | number | Date | null;
  dateRefreshed?: unknown;
};

@Component({
  selector: 'app-services-coros',
  templateUrl: './services.coros.component.html',
  styleUrls: ['../services-abstract-component.directive.scss', './services.coros.component.css'],
  standalone: false
})
export class ServicesCorosComponent extends ServicesAbstractComponentDirective {

  public serviceName = ServiceNames.COROSAPI;
  public showCorosUploadActivityCard = true;
  public minDate = dayjs().subtract(COROS_HISTORY_IMPORT_LIMIT_MONTHS, 'month').toDate();
  public readonly corosToSuuntoRouteID = ACTIVITY_SYNC_ROUTE_IDS.COROSAPI_to_SuuntoApp;
  public isSavingSyncRoute = false;
  public activeActivitySyncDestination: 'suunto' | 'wahoo' | 'coros' = 'suunto';
  public isCheckingCOROSBindingState = false;
  public corosBindingStateCheckError = false;
  public isCOROSBindingStateRetryDisabled = false;
  @Input() initialActivitySyncDestination: 'suunto' | 'wahoo' | 'coros' | null = null;

  private suuntoConnectionSubscription: Subscription | null = null;
  private lastCOROSBindingStateCheckKey: string | null = null;
  private corosBindingStateCheckRevision = 0;
  private disconnectedCOROSConnectionKey: string | null = null;
  private corosBindingStateRetryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private corosBindingStateAutomaticStaleRetryKey: string | null = null;
  private corosBindingStateAutomaticStaleRetryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private isDestroyed = false;
  public suuntoConnectionView: SuuntoServiceConnectionViewModel = buildSuuntoServiceConnectionViewModel({
    hasToken: false,
    serviceMeta: null,
  });

  constructor(protected http: HttpClient,
    protected fileService: AppFileService,
    protected eventService: AppEventService,
    protected authService: AppAuthService,
    protected userService: AppUserService,
    protected route: ActivatedRoute,
    protected windowService: AppWindowService,
    protected snackBar: MatSnackBar) {
    super(http, fileService, eventService, authService, userService, route, windowService, snackBar);
  }

  async requestAndSetToken(params = this.route.snapshot.queryParamMap) {
    const { state, code } = this.getOAuthCallbackParameters(params);
    return this.userService.requestAndSetCurrentUserCOROSAPIAccessToken(state, code);
  }

  get corosServiceMeta(): UserServiceMetaInterface & {
    uploadedActivitiesCount?: number;
    providerUserId?: string;
  } | undefined {
    return this.serviceMeta;
  }

  override async ngOnChanges() {
    if (this.initialActivitySyncDestination) {
      this.activeActivitySyncDestination = this.initialActivitySyncDestination;
    }
    await super.ngOnChanges();
    if (this.connectionViewDestroyed) return;
    this.watchSuuntoConnectionState();
  }

  override ngOnDestroy(): void {
    this.isDestroyed = true;
    this.lastCOROSBindingStateCheckKey = null;
    this.isCheckingCOROSBindingState = false;
    this.clearCOROSBindingStateRetryCooldown();
    this.clearCOROSBindingStateAutomaticStaleRetry();
    super.ngOnDestroy();
    this.suuntoConnectionSubscription?.unsubscribe();
    this.suuntoConnectionSubscription = null;
  }

  protected override onServiceDataChanged(): void {
    void this.checkCOROSBindingStateIfEligible();
  }

  override async deauthorizeService(event: Event | null): Promise<boolean> {
    const connectionKey = this.getCOROSConnectionKey();
    const disconnect = super.deauthorizeService(event);
    // The base method locks synchronously before awaiting confirmation.
    if (this.isDisconnecting) void this.checkCOROSBindingStateIfEligible();
    const didDisconnect = await disconnect;
    if (this.isDestroyed) return didDisconnect;
    if (didDisconnect) {
      this.disconnectedCOROSConnectionKey = connectionKey;
      this.connectionStateChanged.emit(this.isConnectedToService());
    }
    // Cancellation or a newer connection can outlive a discarded check without
    // another metadata update. The disconnected generation remains ineligible.
    void this.checkCOROSBindingStateIfEligible();
    return didDisconnect;
  }

  public retryCOROSBindingStateCheck(): void {
    if (this.isCOROSBindingStateRetryDisabled || this.isCheckingCOROSBindingState
      || this.getCOROSBindingStateCheckKey() === null) return;
    this.hapticsService.selection();
    this.corosBindingStateCheckError = false;
    void this.checkCOROSBindingStateIfEligible(true);
  }

  get hasStoredCOROSConnection(): boolean {
    // Disconnect clears the lifecycle state before the token projection trigger
    // removes the account summaries. Those older summaries cannot revive it.
    const connectionWasCleared = !!this.serviceMeta?.connectionStateGeneration
      && !this.serviceMeta.connectionState;
    const disconnectedLocally = this.disconnectedCOROSConnectionKey !== null
      && this.disconnectedCOROSConnectionKey === this.getCOROSConnectionKey();
    return !this.isDisconnectPending && !connectionWasCleared && !disconnectedLocally
      && (!!this.activeCorosServiceToken || this.forceConnected);
  }

  isConnectedToService = () => !this.isReconnectRequired && this.hasStoredCOROSConnection;

  get isReconnectRequired(): boolean {
    return isReconnectRequiredServiceConnection(this.serviceMeta);
  }

  get isDisconnectPending(): boolean {
    return isDisconnectPendingServiceConnection(this.serviceMeta);
  }

  get isDisconnectManualReviewRequired(): boolean {
    return this.isDisconnectPending && this.serviceMeta?.disconnectManualReviewRequired === true;
  }

  protected override get canConnectWithoutProAccess(): boolean {
    return this.isDisconnectManualReviewRequired;
  }

  get shouldShowConnectAction(): boolean {
    return (!this.isConnectedToService() || this.isReconnectRequired || this.isDisconnectManualReviewRequired)
      && (!this.isDisconnectPending || this.isDisconnectManualReviewRequired);
  }

  get connectButtonLabel(): string {
    return this.isReconnectRequired || this.isDisconnectManualReviewRequired ? 'Reconnect' : 'Connect';
  }

  get connectionDescription(): string {
    const uploadScope = this.isCOROSRouteUploadAvailableForUser
      ? 'activity and route uploads'
      : 'activity uploads';
    return this.isDisconnectManualReviewRequired
      ? 'COROS disconnect retries have stopped. Reconnect COROS to refresh this connection, or contact support if the old connection still appears in COROS.'
      : this.isDisconnectPending
      ? 'Disconnect is pending while COROS finishes deauthorization. Sync and imports are paused for this connection.'
      : this.isReconnectRequired
      ? `Reconnect COROS to resume history imports, ${uploadScope}, and automatic sync.`
      : `Required for history imports, direct ${uploadScope}, and automatic sync involving COROS.`;
  }

  buildRedirectURIFromServiceToken(token: { redirect_uri: string }): string {
    return token.redirect_uri
  }

  get corosOpenId(): string | undefined {
    return this.getCOROSProviderUserId(this.activeCorosServiceToken);
  }

  /**
   * COROS deliveries use exactly one account. New connections are pinned in
   * service metadata; legacy connections use the same deterministic fallback
   * as the backend until their first delivery persists that pin.
   */
  get activeCorosServiceToken(): COROSConnectionAccountLike | undefined {
    const tokens = ((this.serviceTokens || []) as COROSConnectionAccountLike[])
      .filter(token => !!this.getCOROSProviderUserId(token));
    const pinnedOpenId = `${this.corosServiceMeta?.providerUserId || ''}`.trim();
    if (pinnedOpenId) {
      return tokens.find(token => this.getCOROSProviderUserId(token) === pinnedOpenId);
    }

    return [...tokens].sort((left, right) => (
      this.getTokenTimestamp(right.connectedAtMs ?? right.dateRefreshed ?? right.dateCreated)
      - this.getTokenTimestamp(left.connectedAtMs ?? left.dateRefreshed ?? left.dateCreated)
      || `${this.getCOROSProviderUserId(right) || ''}`.localeCompare(`${this.getCOROSProviderUserId(left) || ''}`)
    ))[0];
  }

  getCorosOpenId(token: COROSConnectionAccountLike): string | undefined {
    return this.getCOROSProviderUserId(token);
  }

  private getTokenTimestamp(value: unknown): number {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private getCOROSProviderUserId(account: COROSConnectionAccountLike | undefined): string | undefined {
    const providerUserId = `${account?.providerUserId || account?.openId || ''}`.trim();
    return providerUserId || undefined;
  }

  private getCOROSConnectionKey(): string | null {
    const userID = `${this.user?.uid || ''}`.trim();
    const providerUserId = `${this.getCOROSProviderUserId(this.activeCorosServiceToken) || ''}`.trim();
    return userID && providerUserId
      ? JSON.stringify([userID, providerUserId, this.serviceMeta?.connectionStateGeneration || null])
      : null;
  }

  private getCOROSBindingStateCheckKey(): string | null {
    const connectionKey = this.getCOROSConnectionKey();
    const params = this.route.snapshot.queryParamMap;
    // Metadata emits before the base subscription locks the OAuth callback.
    const hasPendingAuthorization = params.get('serviceName') === this.serviceName
      && (!!params.get('connect') || (!!params.get('code') && !!params.get('state')));
    const isEligible = this.showConnectionSummary
      && connectionKey !== null
      && this.hasStoredCOROSConnection
      && !hasPendingAuthorization
      && !this.isConnecting
      && !this.isDisconnecting
      && !this.isReconnectRequired
      && !this.isDisconnectPending;
    return isEligible ? connectionKey : null;
  }

  private async checkCOROSBindingStateIfEligible(force = false): Promise<void> {
    if (this.isDestroyed) return;
    const checkKey = this.getCOROSBindingStateCheckKey();
    if (checkKey === null) {
      this.corosBindingStateCheckRevision++;
      this.lastCOROSBindingStateCheckKey = null;
      this.isCheckingCOROSBindingState = false;
      this.corosBindingStateCheckError = false;
      this.clearCOROSBindingStateRetryCooldown();
      this.clearCOROSBindingStateAutomaticStaleRetry();
      return;
    }

    if (this.corosBindingStateAutomaticStaleRetryKey !== null
      && this.corosBindingStateAutomaticStaleRetryKey !== checkKey) {
      this.clearCOROSBindingStateAutomaticStaleRetry();
    }
    if (!force && (
      this.lastCOROSBindingStateCheckKey === checkKey
      || this.corosBindingStateAutomaticStaleRetryKey === checkKey
    )) return;
    const checkRevision = ++this.corosBindingStateCheckRevision;
    const isCurrentCheck = () => !this.isDestroyed
      && this.corosBindingStateCheckRevision === checkRevision
      && this.getCOROSBindingStateCheckKey() === checkKey;
    this.lastCOROSBindingStateCheckKey = checkKey;
    this.isCheckingCOROSBindingState = true;
    this.corosBindingStateCheckError = false;
    this.changeDetectorRef.markForCheck();
    try {
      const result = await this.userService.checkCurrentUserCOROSBindingState(
        `${this.user?.uid || ''}`.trim(),
        `${this.getCOROSProviderUserId(this.activeCorosServiceToken) || ''}`.trim(),
        this.serviceMeta?.connectionStateGeneration,
      );
      if (!isCurrentCheck()) return;
      if (this.lastCOROSBindingStateCheckKey === checkKey) {
        this.clearCOROSBindingStateRetryCooldown();
      }
      if (result.status === 'stale' && this.lastCOROSBindingStateCheckKey === checkKey) {
        this.lastCOROSBindingStateCheckKey = null;
        this.scheduleCOROSBindingStateAutomaticStaleRetry(checkKey, result.retryAt);
      } else if (this.lastCOROSBindingStateCheckKey === checkKey) {
        this.clearCOROSBindingStateAutomaticStaleRetry(checkKey);
      }
    } catch (error) {
      if (!isCurrentCheck()) return;
      if (this.lastCOROSBindingStateCheckKey === checkKey) {
        this.corosBindingStateCheckError = true;
        this.setCOROSBindingStateRetryCooldown(this.getCOROSBindingStateRetryAt(error));
        this.clearCOROSBindingStateAutomaticStaleRetry(checkKey);
      }
      this.logger.error(error);
    } finally {
      if (!this.isDestroyed && this.corosBindingStateCheckRevision === checkRevision) {
        if (!isCurrentCheck() && this.lastCOROSBindingStateCheckKey === checkKey) {
          this.lastCOROSBindingStateCheckKey = null;
        }
        this.isCheckingCOROSBindingState = false;
        this.changeDetectorRef.markForCheck();
      }
    }
  }

  private scheduleCOROSBindingStateAutomaticStaleRetry(checkKey: string, rawRetryAt: unknown): void {
    if (this.corosBindingStateAutomaticStaleRetryKey === checkKey) return;
    this.clearCOROSBindingStateAutomaticStaleRetry();
    this.corosBindingStateAutomaticStaleRetryKey = checkKey;

    const retryAt = Number(rawRetryAt);
    const delayMs = Number.isFinite(retryAt) && retryAt > 0
      ? Math.max(0, retryAt - Date.now())
      : COROS_BINDING_STATE_STALE_RETRY_FALLBACK_MS;
    this.corosBindingStateAutomaticStaleRetryTimer = globalThis.setTimeout(() => {
      this.corosBindingStateAutomaticStaleRetryTimer = null;
      if (this.isDestroyed || this.corosBindingStateAutomaticStaleRetryKey !== checkKey) return;

      if (this.getCOROSBindingStateCheckKey() !== checkKey) {
        this.corosBindingStateAutomaticStaleRetryKey = null;
        return;
      }
      void this.checkCOROSBindingStateIfEligible(true);
    }, Math.min(delayMs, 2_147_483_647));
  }

  private clearCOROSBindingStateAutomaticStaleRetry(checkKey?: string): void {
    if (checkKey && this.corosBindingStateAutomaticStaleRetryKey !== checkKey) return;
    if (this.corosBindingStateAutomaticStaleRetryTimer !== null) {
      globalThis.clearTimeout(this.corosBindingStateAutomaticStaleRetryTimer);
      this.corosBindingStateAutomaticStaleRetryTimer = null;
    }
    this.corosBindingStateAutomaticStaleRetryKey = null;
  }

  private getCOROSBindingStateRetryAt(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const details = (error as { details?: unknown }).details;
    if (!details || typeof details !== 'object') return null;
    const retryAt = Number((details as { retryAt?: unknown }).retryAt);
    return Number.isFinite(retryAt) && retryAt > Date.now() ? retryAt : null;
  }

  private setCOROSBindingStateRetryCooldown(retryAt: number | null): void {
    this.clearCOROSBindingStateRetryCooldown();
    if (retryAt === null) return;

    const remainingMs = retryAt - Date.now();
    if (remainingMs <= 0) return;
    this.isCOROSBindingStateRetryDisabled = true;
    this.corosBindingStateRetryTimer = globalThis.setTimeout(() => {
      this.corosBindingStateRetryTimer = null;
      if (this.isDestroyed) return;
      if (retryAt > Date.now()) {
        this.setCOROSBindingStateRetryCooldown(retryAt);
        return;
      }
      this.isCOROSBindingStateRetryDisabled = false;
      this.changeDetectorRef.markForCheck();
    }, Math.min(remainingMs, 2_147_483_647));
  }

  private clearCOROSBindingStateRetryCooldown(): void {
    if (this.corosBindingStateRetryTimer !== null) {
      globalThis.clearTimeout(this.corosBindingStateRetryTimer);
      this.corosBindingStateRetryTimer = null;
    }
    this.isCOROSBindingStateRetryDisabled = false;
  }

  private watchSuuntoConnectionState(): void {
    this.suuntoConnectionSubscription?.unsubscribe();
    this.suuntoConnectionSubscription = null;

    if (!this.user) {
      this.suuntoConnectionView = buildSuuntoServiceConnectionViewModel({
        hasToken: false,
        serviceMeta: null,
      });
      return;
    }

    this.suuntoConnectionSubscription = this.userService.watchSuuntoServiceConnectionView(this.user).subscribe((connectionView) => {
      this.suuntoConnectionView = connectionView;
    });
  }

  get isSuuntoConnected(): boolean {
    return this.suuntoConnectionView.connected && !this.suuntoConnectionView.reconnectRequired;
  }

  get isSuuntoReconnectRequired(): boolean {
    return this.suuntoConnectionView.reconnectRequired;
  }

  get isCorosToSuuntoRouteEnabled(): boolean {
    return this.user?.settings?.serviceSyncSettings?.activitySyncRoutes?.[this.corosToSuuntoRouteID]?.enabled === true;
  }

  get isCorosToSuuntoRouteAvailableForUser(): boolean {
    const userID = `${this.user?.uid || ''}`.trim();
    return isActivitySyncRouteUIDAllowlisted(this.corosToSuuntoRouteID, userID);
  }

  get isCOROSRouteUploadAvailableForUser(): boolean {
    return isCOROSRouteUploadUIDAllowlisted(`${this.user?.uid || ''}`);
  }

  async onCorosToSuuntoRouteToggle(enabled: boolean): Promise<void> {
    if (!this.user || this.isSavingSyncRoute) {
      return;
    }

    if (!this.isCorosToSuuntoRouteAvailableForUser) {
      this.snackBar.open('Activity sync is not available for this account.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && this.isSuuntoReconnectRequired) {
      this.snackBar.open('Reconnect Suunto before turning on automatic activity sync.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && this.isReconnectRequired) {
      this.snackBar.open('Reconnect COROS before turning on automatic activity sync.', undefined, { duration: 4000 });
      return;
    }

    if (enabled && (!this.isConnectedToService() || !this.isSuuntoConnected)) {
      this.snackBar.open('Connect COROS and Suunto before turning on automatic activity sync.', undefined, { duration: 4000 });
      return;
    }

    this.isSavingSyncRoute = true;
    try {
      await this.userService.updateActivitySyncRouteSettings(this.user, {
        [this.corosToSuuntoRouteID]: enabled,
      });

      this.analyticsService.logActivitySyncRouteToggle(this.corosToSuuntoRouteID, enabled);
      this.snackBar.open(enabled ? 'New COROS activities will be sent to Suunto automatically.' : 'Automatic COROS activity sync to Suunto is off.', undefined, { duration: 3000 });
    } catch (error: any) {
      this.logger.error(error);
      this.snackBar.open('Could not update automatic activity sync.', undefined, { duration: 5000 });
    } finally {
      this.isSavingSyncRoute = false;
    }
  }

}
