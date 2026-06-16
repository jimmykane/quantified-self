import { Injectable } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProviderPresentation } from '@shared/provider-presentation';
import { AppEventColorService } from './color/app.event.color.service';
import { LoggerService } from './logger.service';

export interface DataExportOptions {
    attributionLabel?: string | null;
    seriesPresentations?: Record<string, ProviderPresentation | null | undefined>;
}

@Injectable({
    providedIn: 'root'
})
export class DataExportService {

    constructor(
        private clipboard: Clipboard,
        private snackBar: MatSnackBar,
        private appEventColorService: AppEventColorService,
        private logger: LoggerService
    ) { }

    private normalizeNonEmptyString(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }

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

    private buildSeriesAttributionEntries(columns: string[], options?: DataExportOptions): string[] {
        if (!options?.seriesPresentations) {
            return [];
        }

        return columns.reduce<string[]>((entries, column) => {
            const presentation = options.seriesPresentations?.[column];
            if (!presentation) {
                return entries;
            }

            const headerLabel = this.getColumnHeaderName(column).trim() || column;
            entries.push(`${headerLabel}: ${presentation.exportLabel}`);
            return entries;
        }, []);
    }

    private buildMarkdownPrefix(columns: string[], options?: DataExportOptions): string {
        const lines: string[] = [];
        const attributionLabel = this.normalizeNonEmptyString(options?.attributionLabel);
        if (attributionLabel) {
            lines.push(`Source: ${attributionLabel}`);
        }

        const seriesEntries = this.buildSeriesAttributionEntries(columns, options);
        if (seriesEntries.length > 0) {
            lines.push(`Series sources: ${seriesEntries.join(' | ')}`);
        }

        return lines.length > 0
            ? `${lines.map(line => `> ${line}`).join('\n')}\n\n`
            : '';
    }

    private buildTableCaption(columns: string[], options?: DataExportOptions): string {
        const lines: string[] = [];
        const attributionLabel = this.normalizeNonEmptyString(options?.attributionLabel);
        if (attributionLabel) {
            lines.push(`Source: ${attributionLabel}`);
        }

        const seriesEntries = this.buildSeriesAttributionEntries(columns, options);
        if (seriesEntries.length > 0) {
            lines.push(`Series sources: ${seriesEntries.join(' | ')}`);
        }

        if (lines.length === 0) {
            return '';
        }

        return `<caption style="caption-side: top; text-align: left; color: #111827; padding: 0 0 8px; background-color: #ffffff;">${lines.join('<br>')}</caption>`;
    }

    private buildTsvPrefix(columns: string[], options?: DataExportOptions): string {
        const rows: string[] = [];
        const attributionLabel = this.normalizeNonEmptyString(options?.attributionLabel);
        if (attributionLabel) {
            rows.push(`Source\t${attributionLabel}`);
        }

        const seriesEntries = this.buildSeriesAttributionEntries(columns, options);
        if (seriesEntries.length > 0) {
            rows.push(`Series sources\t${seriesEntries.join(' | ')}`);
        }

        return rows.length > 0 ? `${rows.join('\n')}\n\n` : '';
    }

    public copyToMarkdown(data: any[], columns: string[], options?: DataExportOptions): void {
        const headers = columns.map(c => this.getColumnHeaderName(c));
        let markdown = this.buildMarkdownPrefix(columns, options);
        markdown += '| ' + headers.join(' | ') + ' |\n';
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

    public async copyToSheets(data: any[], columns: string[], options?: DataExportOptions): Promise<void> {
        const headers = columns.map(c => this.getColumnHeaderName(c));

        // 1. Generate TSV (Plain Text)
        let tsv = this.buildTsvPrefix(columns, options);
        tsv += headers.join('\t') + '\n';
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
            // Use span with inline style for colors
            const coloredContent = color
                ? `<span style="color: ${color}">${escapeHtml(displayName)}</span>`
                : escapeHtml(displayName);
            return `<th style="color: #111827; background-color: #f8fafc; border: 1px solid #d1d5db;">${coloredContent}</th>`;
        }).join('');

        let html = `<table style="border-collapse: collapse; border: 1px solid #d1d5db; background-color: #ffffff;">${this.buildTableCaption(columns, options)}<thead><tr>${headerCells}</tr></thead><tbody>`;
        data.forEach(row => {
            html += '<tr>';
            columns.forEach(col => {
                const val = row[col];
                let cellContent = '';
                let cellStyle = 'color: #111827; background-color: #ffffff; border: 1px solid #d1d5db;';

                if (col === 'Difference' && val && typeof val === 'object') {
                    // Difference specific logic - use difference color
                    cellContent = escapeHtml(`${val.display} (${val.percent.toFixed(1)}%)`);
                    cellStyle = `color: ${this.appEventColorService.getDifferenceColor(val.percent)}; background-color: #ffffff; border: 1px solid #d1d5db;`;
                } else {
                    // Standard processing with sheet-safe dark text
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
                this.logger.error('DataExportService: Rich copy failed, falling back to basic copy', err);
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
