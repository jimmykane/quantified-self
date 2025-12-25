import { Injectable } from '@angular/core';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';


@Injectable({
  providedIn: 'root',
})
export class AppFileService {
  public downloadFile(blob: Blob, name: string, extension: string): void {
    saveAs(blob, [name, extension].join('.'));
  }

  public async downloadAsZip(files: { data: Blob | ArrayBuffer, fileName: string }[], zipFileName: string): Promise<void> {
    const zip = new JSZip();
    files.forEach(file => {
      zip.file(file.fileName, file.data);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, zipFileName);
  }
}
