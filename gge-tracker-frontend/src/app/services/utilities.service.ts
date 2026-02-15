import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { ApiRestService } from './api-rest.service';
import { ToastService } from './toast.service';
import { ApiLastUpdates, ErrorType } from '@ggetracker-interfaces/empire-ranking';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { FormatNumberPipe } from '@ggetracker-pipes/format-number.pipe';

@Injectable({
  providedIn: 'root',
})
export class UtilitiesService {
  public lastUpdate?: string;
  public dataSubject = new BehaviorSubject<ApiLastUpdates | null>(null);
  public data$ = this.dataSubject.asObservable();
  private apiRestService = inject(ApiRestService);
  private toastService = inject(ToastService);
  private translateService = inject(TranslateService);

  constructor() {
    this.loadLastUpdates();
  }

  public escapeCsv(value: string | null | undefined): string {
    if (value == null) return '';
    return `"${value.replaceAll('"', '""')}"`;
  }

  public constructPlayerLevel(level: number, legendaryLevel: number): string {
    if (legendaryLevel >= 70) {
      return `${level}/${legendaryLevel}`;
    }
    return level.toString();
  }

  public parseValue(value: string | number): number {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    let string_ = value.replaceAll(/\s+/g, '').replaceAll(',', '').toUpperCase();
    let multiplier = 1;
    if (string_.endsWith('B')) {
      multiplier = 1_000_000_000;
      string_ = string_.slice(0, -1);
    } else if (string_.endsWith('M')) {
      multiplier = 1_000_000;
      string_ = string_.slice(0, -1);
    } else if (string_.endsWith('K')) {
      multiplier = 1000;
      string_ = string_.slice(0, -1);
    }
    const numeric = Number(string_);
    if (Number.isNaN(numeric)) return 0;
    return numeric * multiplier;
  }

  public formatNumber(formatNumberPipe: FormatNumberPipe, value: number): string {
    return formatNumberPipe.transform(value);
  }

  public async exportDataXlsx(
    worksheetName: string,
    headers: string[],
    dataRows: any[][],
    fileName: string,
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(worksheetName);
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    dataRows.forEach((dataRow) => {
      worksheet.addRow(dataRow);
    });
    for (let colIndex = 0; colIndex < worksheet.columns.length; colIndex++) {
      const column = worksheet.columns[colIndex];
      let maxLength = 10;
      for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex++) {
        const row = worksheet.getRow(rowIndex);
        const cell = row.getCell(colIndex + 1);
        const cellValue = cell.value ? cell.value.toString() : '';
        maxLength = Math.max(maxLength, cellValue.length);
        if (cellValue.startsWith('url=')) {
          const imageUrl = cellValue.slice(4);
          const imageData = await this.loadImageNativeSize(imageUrl);
          const imageId = workbook.addImage({
            base64: imageData.base64,
            extension: 'png',
          });
          if (imageData.height > 20) {
            const scale = 20 / imageData.height;
            imageData.width = imageData.width * scale;
            imageData.height = 20;
          }
          worksheet.addImage(imageId, {
            tl: { col: colIndex, row: rowIndex - 1 },
            ext: { width: imageData.width, height: imageData.height },
          });
          const items = imageUrl.split('/');
          cell.value = items.at(-1)?.split('.')[0];
          maxLength = Math.max(maxLength, 5);
        }
      }
      column.width = maxLength + 2;
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, fileName);
  }

  public async loadImageNativeSize(url: string): Promise<{ base64: string; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;

      img.addEventListener('load', () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;

        const context = canvas.getContext('2d');
        if (!context) {
          reject('Canvas context not available');
          return;
        }

        context.drawImage(img, 0, 0);

        resolve({
          base64: canvas.toDataURL('image/png'),
          width: img.width,
          height: img.height,
        });
      });

      img.addEventListener('error', (error) => {
        reject(error);
      });
    });
  }

  public async loadImageAsBase64(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result as string));
      reader.readAsDataURL(blob);
    });
  }

  public loadLastUpdates(): void {
    void this.apiRestService.getLastUpdates(true).then((response) => {
      try {
        if (!response.success) throw new Error('Error fetching last updates');
        const lastUpdate = response.data;
        this.dataSubject.next(lastUpdate);
        const dateLoot = new Date(lastUpdate.last_update['loot']);
        const dateMight = new Date(lastUpdate.last_update['might']);
        setInterval(() => {
          void this.updateRefreshDate(dateLoot, dateMight);
        }, 60_000);
        void this.updateRefreshDate(dateLoot, dateMight);
      } catch {
        this.toastService.add(ErrorType.ERROR_OCCURRED, 5000);
      }
    });
  }

  private async updateRefreshDate(dateLoot: Date, dateMight: Date): Promise<void> {
    if (dateMight.getTime() < dateLoot.getTime()) {
      const translation = await firstValueFrom(this.translateService.get('Mise à jour en cours'));
      this.lastUpdate = translation;
      return;
    }
    const now = new Date();
    const diff = now.getTime() - dateMight.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const langs = {
      jour: await firstValueFrom(this.translateService.get('jour')),
      jours: await firstValueFrom(this.translateService.get('jours')),
      heure: await firstValueFrom(this.translateService.get('heure')),
      heures: await firstValueFrom(this.translateService.get('heures')),
      minute: await firstValueFrom(this.translateService.get('minute')),
      minutes: await firstValueFrom(this.translateService.get('minutes')),
      seconde: await firstValueFrom(this.translateService.get('seconde')),
      secondes: await firstValueFrom(this.translateService.get('secondes')),
      'il y a': await firstValueFrom(this.translateService.get('il y a')),
      et: await firstValueFrom(this.translateService.get('et')),
    };
    if (days > 0) {
      this.lastUpdate = `${langs['il y a']} ${days} ${langs[days > 1 ? 'jours' : 'jour']}`;
    } else if (hours > 0) {
      this.lastUpdate = `${langs['il y a']} ${hours} ${langs[hours > 1 ? 'heures' : 'heure']} ${langs['et']} ${minutes % 60} ${langs[minutes % 60 > 1 ? 'minutes' : 'minute']}`;
    } else if (minutes > 0) {
      this.lastUpdate = `${langs['il y a']} ${minutes} ${langs[minutes > 1 ? 'minutes' : 'minute']}`;
    } else {
      this.lastUpdate = `${langs['il y a']} ${seconds} ${langs[seconds > 1 ? 'secondes' : 'seconde']}`;
    }
  }
}
