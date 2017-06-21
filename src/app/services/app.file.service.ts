import {Injectable} from '@angular/core';


@Injectable()
export class FileService {
  public static downloadFile(blob: Blob, name: string, extension: string): void {
    const url = window.URL.createObjectURL(blob);
    const element = document.createElement('a');
    element.href = url;
    element.download = [name, extension].join('.');
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    element.parentNode.removeChild(element);
  }
}
