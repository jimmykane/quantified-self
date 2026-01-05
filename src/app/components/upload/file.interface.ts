import { UPLOAD_STATUS } from './upload-status/upload.status';

export interface FileInterface {
  id?: string,
  jobId?: string,
  file: File,
  name: string,
  status: UPLOAD_STATUS,
  extension: string,
  filename: string,
}
