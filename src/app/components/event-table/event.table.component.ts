import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Injectable,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  inject
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { AppBreakpoints } from '../../constants/breakpoints';
import { AppEventService } from '../../services/app.event.service';
import { Router } from '@angular/router';
import { MatCard } from '@angular/material/card';
import { MatPaginator, MatPaginatorIntl, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort } from '@angular/material/sort';
import { AppEventInterface } from '../../../../functions/src/shared/app-event.interface';
import { MatTableDataSource } from '@angular/material/table';
import { SelectionModel } from '@angular/cdk/collections';
import { DatePipe } from '@angular/common';
import { EventInterface } from '@sports-alliance/sports-lib';
import { User } from '@sports-alliance/sports-lib';
import { debounceTime, take, map } from 'rxjs/operators';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { rowsAnimation } from '../../animations/animations';
import { DataActivityTypes } from '@sports-alliance/sports-lib';
import { DeleteConfirmationComponent } from '../delete-confirmation/delete-confirmation.component';
import { AppUserService } from '../../services/app.user.service';
import { AppAnalyticsService } from '../../services/app.analytics.service';
import { AppEventColorService } from '../../services/color/app.event.color.service';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { DataTableAbstractDirective, StatRowElement } from '../data-table/data-table-abstract.directive';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { EventsExportFormComponent } from '../events-export-form/events-export.form.component';
import { MatDialog } from '@angular/material/dialog';
import { OrderByDirection } from 'firebase/firestore';
import { AppFileService } from '../../services/app.file.service';
import { LoggerService } from '../../services/logger.service';
import { AppProcessingService } from '../../services/app.processing.service';
import { AppEventUtilities } from '../../utils/app.event.utilities';
import { Firestore, doc, collection } from '@angular/fire/firestore';

@Component({
  selector: 'app-event-table',
  templateUrl: './event.table.component.html',
  styleUrls: ['./event.table.component.css'],
  animations: [
    rowsAnimation,
  ],
  providers: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})

export class EventTableComponent extends DataTableAbstractDirective implements OnChanges, OnInit, OnDestroy, AfterViewInit {
  @Input() user: User;
  @Input() events: EventInterface[];
  @Input() targetUser: User;
  @Input() showActions: boolean;
  @ViewChild(MatSort, { static: true }) sort: MatSort;
  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatCard, { static: true }) table: MatCard;

  data: MatTableDataSource<any> = new MatTableDataSource<StatRowElement>();
  selection = new SelectionModel(true, []);

  selectedColumns = AppUserService.getDefaultSelectedTableColumns();

  public show = true

  private deleteConfirmationSubscription: Subscription;
  private sortSubscription: Subscription;
  private breakpointSubscription: Subscription;
  private isHandset = false;


  private searchSubject: Subject<string> = new Subject();
  private analyticsService = inject(AppAnalyticsService);
  private firestore = inject(Firestore);

  constructor(private snackBar: MatSnackBar,
    private eventService: AppEventService,
    private deleteConfirmationBottomSheet: MatBottomSheet,
    private userService: AppUserService,
    changeDetector: ChangeDetectorRef,
    private eventColorService: AppEventColorService,
    private dialog: MatDialog,
    private fileService: AppFileService,
    private router: Router, private datePipe: DatePipe,
    private logger: LoggerService,
    private processingService: AppProcessingService,
    private breakpointObserver: BreakpointObserver) {
    super(changeDetector);
  }


  ngOnChanges(simpleChanges: SimpleChanges): void {
    this.isLoading ? this.loading() : this.loaded();
    if (!this.events) {
      this.loading();
      return;
    }
    if (this.events && simpleChanges.events && this.data.paginator && this.data.sort) { // If there is no paginator and sort then the compoenent is not initialized on view
      this.processChanges();
    }
    if (this.user && simpleChanges.user) {
      this.selectedColumns = this.user.settings?.dashboardSettings?.tableSettings?.selectedColumns || AppUserService.getDefaultSelectedTableColumns();
      this.paginator?._changePageSize(this.user.settings?.dashboardSettings?.tableSettings?.eventsPerPage || 10);
    }
  }

  ngOnInit(): void {
    if (!this.user) {
      throw new Error(`Component needs user`)
    }
    this.searchSubject.pipe(
      debounceTime(250)
    ).subscribe(searchTextValue => {
      this.search(searchTextValue);
    });

    this.breakpointSubscription = this.breakpointObserver
      .observe([AppBreakpoints.HandsetOrTabletPortrait])
      .subscribe(result => {
        this.isHandset = result.matches;
        if (this.events) {
          this.processChanges();
        }
        this.changeDetector.markForCheck();
      });
  }

  ngAfterViewInit() {
    this.data.paginator = this.paginator;
    this.data.sort = this.sort;
    this.data.sortingDataAccessor = (statRowElement: StatRowElement, header) => {
      return statRowElement[`sort.${header}`];
    };
    this.sortSubscription = this.sort.sortChange.subscribe(async (sort) => {
      if (this.user.settings.dashboardSettings.tableSettings.active !== sort.active || this.user.settings.dashboardSettings.tableSettings.direction !== sort.direction) {
        this.user.settings.dashboardSettings.tableSettings.active = sort.active;
        this.user.settings.dashboardSettings.tableSettings.direction = sort.direction as OrderByDirection;
        await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
      }
    });
    if (this.events) {
      this.processChanges();
    }
  }

  checkBoxClick(row) {
    this.selection.toggle(row);
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected() {
    const numSelected = this.selection.selected.length;
    const numRows = this.data.data.length;
    return numSelected === numRows;
  }


  /** Selects all rows if they are not all selected; otherwise clear selection. */
  masterToggle() {
    this.isAllSelected() ?
      this.selection.clear() :
      this.data.data.forEach(row => this.selection.select(row));
  }

  async mergeSelection(event) {
    // Show loading
    this.loading();
    // Remove all subscriptions
    this.unsubscribeFromAll();
    // First fetch them complete
    const promises: Promise<EventInterface>[] = [];
    this.selection.selected.forEach((selected) => {
      const obs = this.eventService.getEventActivitiesAndAllStreams(this.user, selected.Event.getID());
      if (obs) {
        promises.push(firstValueFrom(obs.pipe(
          take(1),
          map(e => {
            if (e && !(e as any).getStartDate) {
              (e as any).getStartDate = () => e.startDate || new Date();
            }
            return e;
          })
        )) as Promise<EventInterface>);
      }
    });
    // Now we can clear the selection
    this.selection.clear();

    // 1. Fetch Events
    let events: any[];
    try {
      events = await Promise.all(promises);
    } catch (e: any) {
      this.logger.error('Merge failed during event fetch', e);
      this.loaded();
      this.snackBar.open(e.message || 'Error loading events for merge', 'Close', { duration: 5000, panelClass: ['error-snackbar'] });
      return;
    }

    // 2. Collect Original Files from source events
    const validOriginalFiles: { data: any, extension: string, startDate: Date }[] = [];


    // We need to fetch the actual file data for each event
    // The 'events' array contains full Event objects, hopefully with originalFile metadata from getEventActivitiesAndAllStreams -> getEventAndActivities logic

    const fileFetchPromises: Promise<void>[] = [];

    for (const evt of events) {
      // Check for array
      if (evt.originalFiles && Array.isArray(evt.originalFiles)) {
        for (const fileMeta of evt.originalFiles) {
          fileFetchPromises.push((async () => {
            try {
              const buffer = await this.eventService.downloadFile(fileMeta.path);
              // Extract extension from path
              const parts = fileMeta.path.split('.');
              const ext = parts[parts.length - 1];
              const eventStartDate = this.fileService.toDate(evt.startDate);
              validOriginalFiles.push({ data: buffer, extension: ext, startDate: fileMeta.startDate || eventStartDate || new Date() });
            } catch (e) {
              this.logger.error('Failed to download source file for merge', fileMeta, e);
            }
          })());
        }
      }
      // Check for single legacy
      else if (evt.originalFile && evt.originalFile.path) {
        fileFetchPromises.push((async () => {
          try {
            const buffer = await this.eventService.downloadFile(evt.originalFile.path);
            const parts = evt.originalFile.path.split('.');
            const ext = parts[parts.length - 1];
            const eventStartDate = this.fileService.toDate(evt.startDate);
            validOriginalFiles.push({ data: buffer, extension: ext, startDate: evt.originalFile.startDate || eventStartDate || new Date() });
          } catch (e) {
            this.logger.error('Failed to download source file for merge', evt.originalFile, e);
          }
        })());
      }
    }

    try {
      if (fileFetchPromises.length > 0) {
        await Promise.all(fileFetchPromises);
      }
    } catch (e) {
      this.logger.warn('Error fetching some original files, proceeding with merge anyway', e);
    }

    events.forEach((e) => {
      if (e && !(e as any).getStartDate) {
        (e as any).getStartDate = () => e.startDate || new Date();
      }
    });

    const mergedEvent = AppEventUtilities.mergeEventsWithId(
      events,
      () => doc(collection(this.firestore, 'users')).id
    ) as AppEventInterface;

    try {
      // Pass the collected files to the writer
      // Note: writeAllEventData signature updated to accept array
      this.logger.log('[EventTable] Merging event. Source events:', events);
      this.logger.log('[EventTable] Valid original files to write:', validOriginalFiles);
      await this.eventService.writeAllEventData(this.user, mergedEvent, validOriginalFiles);

      this.analyticsService.logEvent('merge_events');
      await this.router.navigate(['/user', this.user.uid, 'event', mergedEvent.getID()], {});
      this.snackBar.open('Events merged', null, {
        duration: 2000,
      });
    } catch (e) {
      this.logger.captureException(e, {
        extra: {
          data_event: mergedEvent.toJSON(),
          activities: mergedEvent.getActivities().map(activity => activity.toJSON()),
        }
      });
      this.loaded();
      this.snackBar.open('Could not merge events', null, {
        duration: 5000,
      });
    }
  }

  async deleteSelection() {
    this.loading();
    const deleteConfirmationBottomSheet = this.deleteConfirmationBottomSheet.open(DeleteConfirmationComponent);
    this.deleteConfirmationSubscription = deleteConfirmationBottomSheet.afterDismissed().subscribe(async (result) => {
      if (!result) {
        this.loaded();
        return;
      }
      this.unsubscribeFromAll();
      const deletePromises = [];
      const eventsToDelete = this.selection.selected.map(selected => selected.Event);
      eventsToDelete.forEach((event) => deletePromises.push(this.eventService.deleteAllEventData(this.user, event.getID())));
      this.selection.clear();
      await Promise.all(deletePromises);

      // Update local view
      if (this.events) {
        const deletedIds = new Set(eventsToDelete.map(e => e.getID()));
        this.events = this.events.filter(e => !deletedIds.has(e.getID()));
        this.processChanges();
      }

      this.analyticsService.logEvent('delete_events');
      this.snackBar.open('Events deleted', null, {
        duration: 2000,
      });
      this.loaded();
    });
  }

  public downloadAsCSV(event) {
    this.dialog.open(EventsExportFormComponent, {
      // width: '100vw',
      disableClose: false,
      data: {
        events: this.selection.selected.map(selected => selected.Event),
        user: this.user,
      },
    });
  }

  public async downloadOriginals() {
    // Start background job instead of blocking UI
    const jobId = this.processingService.addJob('download', 'Preparing download...');

    try {
      const selectedEvents = this.selection.selected.map(s => s.Event) as EventInterface[];
      if (selectedEvents.length === 0) {
        this.snackBar.open('No events selected', null, { duration: 2000 });
        this.processingService.removeJob(jobId);
        return;
      }

      // Collect all file metadata from selected events
      const filesToDownload: { path: string, fileName: string }[] = [];
      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      this.processingService.updateJob(jobId, { title: 'Gathering file info...', progress: 10 });

      for (const event of selectedEvents) {
        // Use shared utility for date conversion
        const startDate = this.fileService.toDate(event.startDate);

        if (startDate) {
          if (!minDate || startDate < minDate) minDate = startDate;
          if (!maxDate || startDate > maxDate) maxDate = startDate;
        }

        const appEvent = event as any;
        const eventId = event.getID ? event.getID() : null;

        // Handle array of original files
        if (appEvent.originalFiles && Array.isArray(appEvent.originalFiles) && appEvent.originalFiles.length > 0) {
          const totalFiles = appEvent.originalFiles.length;
          appEvent.originalFiles.forEach((fileMeta: any, index: number) => {
            if (fileMeta.path) {
              const extension = this.fileService.getExtensionFromPath(fileMeta.path);
              const fileDate = this.fileService.toDate(fileMeta.startDate) || startDate;
              const fileName = this.fileService.generateDateBasedFilename(
                fileDate, extension, index + 1, totalFiles, eventId
              );
              filesToDownload.push({ path: fileMeta.path, fileName });
            }
          });
        }
        // Handle legacy single original file
        else if (appEvent.originalFile && appEvent.originalFile.path) {
          const extension = this.fileService.getExtensionFromPath(appEvent.originalFile.path);
          const fileName = this.fileService.generateDateBasedFilename(startDate, extension, undefined, undefined, eventId);
          filesToDownload.push({ path: appEvent.originalFile.path, fileName });
        }
      }

      if (filesToDownload.length === 0) {
        this.snackBar.open('No original files available for selected events', null, { duration: 3000 });
        this.processingService.removeJob(jobId);
        return;
      }

      // Download all files
      this.processingService.updateJob(jobId, { title: `Downloading ${filesToDownload.length} files...`, progress: 20 });

      const downloadedFiles: { data: ArrayBuffer, fileName: string }[] = [];
      let completed = 0;

      for (const file of filesToDownload) {
        try {
          const data = await this.eventService.downloadFile(file.path);
          downloadedFiles.push({ data, fileName: file.fileName });
        } catch (e) {
          this.logger.error('Failed to download file:', file.path, e);
        }
        completed++;
        const progress = 20 + Math.round((completed / filesToDownload.length) * 60); // 20% to 80%
        this.processingService.updateJob(jobId, {
          progress,
          details: `Downloaded ${completed} of ${filesToDownload.length}`
        });
      }

      if (downloadedFiles.length === 0) {
        this.snackBar.open('Failed to download any files', null, { duration: 3000 });
        this.processingService.failJob(jobId, 'No files downloaded');
        return;
      }

      this.processingService.updateJob(jobId, { title: 'Zipping files...', progress: 85 });

      // Generate ZIP filename using shared utility
      const zipFileName = this.fileService.generateDateRangeZipFilename(minDate, maxDate);

      // Create and download ZIP
      await this.fileService.downloadAsZip(downloadedFiles, zipFileName);

      this.processingService.completeJob(jobId, `Downloaded ${downloadedFiles.length} files`);
      this.analyticsService.logEvent('download_originals', { count: downloadedFiles.length });
    } catch (e) {
      this.logger.error('Error downloading originals:', e);
      this.processingService.failJob(jobId, 'Download failed');
      this.snackBar.open('Error downloading files', null, { duration: 3000 });
    }
  }

  // Todo cache this please
  getColumnsToDisplay() {
    // push all the rest
    let columns = [
      'Checkbox',
      'Start Date',
      ...(this.selectedColumns || [])
        .filter(column => column !== 'Description')
        .sort(function (a, b) {
          const defaultColumns = AppUserService.getDefaultSelectedTableColumns();
          return defaultColumns.indexOf(a) - defaultColumns.indexOf(b);
        }),
      'Description',
      'Actions'
    ]

    if (!this.showActions) {
      columns = columns.filter(column => column !== 'Checkbox' && column !== 'Actions');
    }

    return columns
  }

  async saveEventDescription(description: string, event: EventInterface) {
    event.description = description;
    await this.eventService.writeAllEventData(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  async saveEventName(name: string, event: EventInterface) {
    event.name = name;
    await this.eventService.writeAllEventData(this.user, event);
    this.snackBar.open('Event saved', null, {
      duration: 2000,
    });
  }

  // Noop due to bugs
  async pageChanges(pageEvent: PageEvent) {
    // @important This is nasty because it's called if anything almost changes
    // this.user.settings.dashboardSettings.tableSettings.eventsPerPage = pageEvent.pageSize;
    // return this.userService.updateUserProperties(this.user, {settings: this.user.settings})
  }

  searchTerm: string = '';

  search(searchTerm: string) {
    this.searchTerm = searchTerm;
    this.data.filter = searchTerm.trim().toLowerCase();
  }

  onSearchInput(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue);
  }

  clearSearch() {
    this.searchTerm = '';
    this.search('');
  }

  onKeyUp(event: KeyboardEvent) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.searchSubject.next(filterValue);
  }

  async selectedColumnsChange(event: string[]) {
    this.selectedColumns = event
    this.user.settings.dashboardSettings.tableSettings.selectedColumns = this.selectedColumns
    await this.userService.updateUserProperties(this.user, { settings: this.user.settings })
  }

  ngOnDestroy() {
    this.unsubscribeFromAll();
    if (this.breakpointSubscription) {
      this.breakpointSubscription.unsubscribe();
    }
  }

  isSticky(column: string) {
    return false
  }

  isStickyEnd(column: string) {
    return false
  }

  private processChanges() {
    if (!this.events) {
      return;
    }

    this.selection.clear();
    // this.data = new MatTableDataSource<any>(data);
    this.data.data = this.events.reduce((EventRowElementsArray, event) => {
      if (!event) {
        return EventRowElementsArray;
      }

      const statRowElement = this.getStatsRowElement(event.getStatsAsArray(), (<DataActivityTypes>event.getStat(DataActivityTypes.type)) ? (<DataActivityTypes>event.getStat(DataActivityTypes.type)).getValue() : [ActivityTypes.unknown], this.user.settings.unitSettings, event.isMerge);

      statRowElement['Privacy'] = event.privacy;
      statRowElement['Name'] = event.name;
      const dateFormat = this.isHandset ? 'd MMM yy' : 'EEEEEE d MMM yy HH:mm';
      statRowElement['Start Date'] = (event.startDate instanceof Date && !isNaN(+event.startDate)) ? this.datePipe.transform(event.startDate, dateFormat) : 'None?';
      statRowElement['Activity Types'] = event.getActivityTypesAsString();
      statRowElement['Merged Event'] = event.isMerge;
      statRowElement['Description'] = event.description;
      statRowElement['Device Names'] = event.getDeviceNamesAsString();
      statRowElement['Color'] = this.eventColorService.getColorForActivityTypeByActivityTypeGroup(
        event.getActivityTypesAsArray().length > 1 ? ActivityTypes.Multisport : ActivityTypes[event.getActivityTypesAsArray()[0]]
      );
      statRowElement['Gradient'] = this.eventColorService.getGradientForActivityTypeGroup(
        event.getActivityTypesAsArray().length > 1 ? ActivityTypes.Multisport : ActivityTypes[event.getActivityTypesAsArray()[0]]
      );
      statRowElement['Event'] = event;

      // Add the sorts
      statRowElement['sort.Start Date'] = event.startDate.getTime();
      statRowElement['sort.Activity Types'] = statRowElement['Activity Types'];
      statRowElement['sort.Description'] = statRowElement['Description'];
      statRowElement['sort.Device Names'] = statRowElement['Device Names'];

      EventRowElementsArray.push(statRowElement);
      return EventRowElementsArray;
    }, []);
    this.loaded();

  }

  private unsubscribeFromAll() {
    if (this.deleteConfirmationSubscription) {
      this.deleteConfirmationSubscription.unsubscribe();
    }
    if (this.sortSubscription) {
      this.sortSubscription.unsubscribe();
    }
  }
}


@Injectable()
export class MatPaginatorIntlFireStore extends MatPaginatorIntl {
  itemsPerPageLabel = 'Items';
  nextPageLabel = 'Next';
  previousPageLabel = 'Previous';
}
