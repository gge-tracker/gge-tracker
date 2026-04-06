import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-loading',
    imports: [TranslateModule],
    templateUrl: './loading.component.html',
    styleUrl: './loading.component.css'
})
export class LoadingComponent {}
