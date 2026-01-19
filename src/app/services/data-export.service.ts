import { Injectable } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppEventColorService } from './color/app.event.color.service';

@Injectable({
    providedIn: 'root'
})
export class DataExportService {

    constructor(
        private clipboard: Clipboard,
        private snackBar: MatSnackBar,
        private appEventColorService: AppEventColorService
    ) { }

    /**
     * Cleans column headers by removing internal color codes (e.g., "Player 1 #ff0000" -> "Player 1")
     * Preserves standard headers like "Name" and "Difference".
     */
    public getColumnHeaderName(columnHeader: string): string {
        if (columnHeader === 'Name' || columnHeader === 'Difference') {
            return columnHeader;
        }
        // Remove last 7 chars (#xxxxxx)
        return columnHeader.slice(0, -7);
    }

    /**
     * Helper to process row values for export.
     * Flattens objects (like Difference) and handles null/undefined.
     */
    private processRowValues(row: any, columns: string[]): string[] {
        return columns.map(col => {
            const val = row[col];
            if (col === 'Difference' && val && typeof val === 'object') {
                // Flatten difference for export: "-5.0 (-2.5%)"
                return `${val.display} (${val.percent.toFixed(1)}%)`;
            }
            return val === null || val === undefined ? '' : String(val);
        });
    }

    public copyToMarkdown(data: any[], columns: string[]): void {
        const headers = columns.map(c => this.getColumnHeaderName(c));
        let markdown = '| ' + headers.join(' | ') + ' |\n';
        markdown += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

        data.forEach(row => {
            const rowValues = this.processRowValues(row, columns);
            const escapedValues = rowValues.map(v => {
                const s = v === null || v === undefined ? '' : String(v);
                // First escape backslashes, then escape pipes for Markdown tables
                return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
            });
            markdown += '| ' + escapedValues.join(' | ') + ' |\n';
        });

        const success = this.clipboard.copy(markdown);
        if (success) {
            this.snackBar.open('Copied to clipboard (Markdown)', 'Dismiss', {
                duration: 3000,
            });
        } else {
            this.snackBar.open('Failed to copy', 'Dismiss', { duration: 3000 });
        }
    }

    public async copyToSheets(data: any[], columns: string[]): Promise<void> {
        const headers = columns.map(c => this.getColumnHeaderName(c));

        // 1. Generate TSV (Plain Text)
        let tsv = headers.join('\t') + '\n';
        data.forEach(row => {
            const rowValues = this.processRowValues(row, columns);
            // Replace tabs with spaces to prevent breaking TSV structure
            const escapedValues = rowValues.map(v => v.replace(/\t/g, ' '));
            tsv += escapedValues.join('\t') + '\n';
        });

        // 2. Generate HTML Table (Rich Text)
        // Simple HTML escape for values
        const escapeHtml = (text: string) => text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");

        // Extract activity colors from column headers (format: "Creator Name #xxxxxx")
        const getColumnColor = (col: string): string | null => {
            if (col === 'Name' || col === 'Difference') {
                return null;
            }
            // Last 7 chars contain the color code (#xxxxxx)
            return col.slice(-7);
        };

        // Build header row with activity colors
        const headerCells = columns.map(col => {
            const displayName = this.getColumnHeaderName(col);
            const color = getColumnColor(col);
            // Use font tag for better spreadsheet compatibility
            const coloredContent = color
                ? `<font color="${color}">${escapeHtml(displayName)}</font>`
                : escapeHtml(displayName);
            return `<th style="color: white; border: 1px solid white;">${coloredContent}</th>`;
        }).join('');

        let html = `<table style="border-collapse: collapse; border: 1px solid white;"><thead><tr>${headerCells}</tr></thead><tbody>`;
        data.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                const val = row[col];
                let cellContent = '';
                let cellStyle = 'color: white; border: 1px solid white;';

                if (col === 'Difference' && val && typeof val === 'object') {
                    // Difference specific logic - use difference color
                    cellContent = escapeHtml(`${val.display} (${val.percent.toFixed(1)}%)`);
                    cellStyle = `color: ${this.appEventColorService.getDifferenceColor(val.percent)}; border: 1px solid white;`;
                } else {
                    // Standard processing with white text
                    cellContent = escapeHtml(val === null || val === undefined ? '' : String(val));
                }

                html += `<td style="${cellStyle}">${cellContent}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table>';

        // 3. Write to Clipboard using Navigator API if available
        if (navigator.clipboard && navigator.clipboard.write) {
            try {
                // Use Promises for the Blobs inside ClipboardItem.
                // This pattern is required by iOS Safari to reliably maintain user gesture activation
                // during the asynchronous clipboard write operation.
                const item = new ClipboardItem({
                    'text/plain': Promise.resolve(new Blob([tsv], { type: 'text/plain' })),
                    'text/html': Promise.resolve(new Blob([html], { type: 'text/html' }))
                });

                await navigator.clipboard.write([item]);
                this.snackBar.open('Copied to clipboard (Sheets)', 'Dismiss', {
                    duration: 3000,
                });
            } catch (err) {
                console.error('DataExportService: Rich copy failed, falling back to basic copy', err);
                // Fallback to simple text copy
                this.fallbackCopy(tsv, 'Sheets (Text only)');
            }
        } else {
            // Fallback for older browsers
            this.fallbackCopy(tsv, 'Sheets');
        }
    }

    private fallbackCopy(text: string, formatDescription: string): void {
        const success = this.clipboard.copy(text);
        if (success) {
            this.snackBar.open(`Copied to clipboard (${formatDescription})`, 'Dismiss', {
                duration: 3000,
            });
        } else {
            this.snackBar.open('Failed to copy', 'Dismiss', { duration: 3000 });
        }
    }
}
