import { Injectable } from '@angular/core';
import { FileInterface } from '../../components/upload/file.interface';
import { BehaviorSubject, Observable } from 'rxjs';
import { UPLOAD_STATUS } from '../../components/upload/upload-status/upload.status';

@Injectable({
  providedIn: 'root',
})
export class AppFilesStatusService {

  private files: FileInterface[] = [];
  private filesSubject: BehaviorSubject<FileInterface[]> = new BehaviorSubject([]);

  getFiles(): Observable<FileInterface[]> {
    return this.filesSubject.asObservable();
  }

  addOrUpdate(file: FileInterface): FileInterface {
    file.id = file.id || '_' + Math.random().toString(36).substr(2, 9);
    const index = this.files.findIndex(localFile => localFile.id === file.id);
    if (index === -1) {
      this.files.push(file)
    } else {
      this.files[index] = file;
    }
    // Emit one last time the status to others
    this.filesSubject.next(Object.assign([], this.files));
    // Then clean up
    if (this.files.filter(localfile => localfile.status === UPLOAD_STATUS.PROCESSING).length === 0) {
      this.files = [];
    }
    // And re-emmit empty
    this.filesSubject.next(Object.assign([], this.files));
    return file
  }
}
