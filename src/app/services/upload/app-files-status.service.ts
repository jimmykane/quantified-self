import {Injectable} from '@angular/core';
import { ArrayDataSource } from '@angular/cdk/collections';
import { FileInterface } from '../../components/upload/file.interface';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class AppFilesStatusService {

  private files: FileInterface[] = [];
  private filesSubject: BehaviorSubject<FileInterface[]> = new BehaviorSubject([]);

  public addFile(file: FileInterface): FileInterface {
    file.id = file.id || '_' + Math.random().toString(36).substr(2, 9);
    this.files.push(file);
    this.filesSubject.next(Object.assign([], this.files));
    return file;
  }

  getFiles(): Observable<FileInterface[]> {
    return this.filesSubject.asObservable();
  }

  updateFile(file: FileInterface) {
    const index = this.files.findIndex(localFile => localFile.id === file.id);
    if (index === -1) {
      return
    }
    this.files[index] = file;
    this.filesSubject.next(Object.assign([], this.files));
  }


}
