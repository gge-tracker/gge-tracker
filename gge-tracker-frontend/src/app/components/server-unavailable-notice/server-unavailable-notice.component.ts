import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-server-unavailable-notice',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './server-unavailable-notice.component.html',
  styleUrl: './server-unavailable-notice.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerUnavailableNoticeComponent {
  public readonly server = input.required<string>();
  public readonly discordUrl = 'https://discord.gg/eb6WSHQqYh';
}
