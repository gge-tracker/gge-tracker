import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { TranslatePipe } from '@ngx-translate/core';
import { LEGAL_DOCUMENTS, LegalDocument, LegalDocumentId } from './legal-documents';

const CONTACT_EMAIL = 'contact@gge-tracker.com';

@Component({
  selector: 'app-legal-document',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './legal-document.component.html',
  standalone: true,
  styleUrl: './legal-document.component.css',
})
export class LegalDocumentComponent extends GenericComponent {
  public readonly document: LegalDocument;
  public readonly updatedOn: string;
  public readonly links: Record<string, string> = {
    email: `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`,
    discord: '<a href="https://discord.gg/eb6WSHQqYh">Discord</a>',
    docs: '<a href="https://docs.gge-tracker.com">docs.gge-tracker.com</a>',
    cnil: '<a href="https://www.cnil.fr">www.cnil.fr</a>',
    github: '<a href="https://github.com/gge-tracker/gge-tracker">GitHub</a>',
  };

  constructor() {
    super();
    this.isInLoading = false;
    const id = this.route.snapshot.data['document'] as LegalDocumentId;
    this.document = LEGAL_DOCUMENTS[id];
    this.updatedOn = new Intl.DateTimeFormat(this.langageService.getCurrentLocale(), {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(new Date(this.document.updatedOn));
  }
}
