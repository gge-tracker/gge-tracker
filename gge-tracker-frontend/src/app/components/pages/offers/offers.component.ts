import { Component, OnInit } from '@angular/core';

import { ApiOffer, Offer } from '@ggetracker-interfaces/empire-ranking';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';

@Component({
  selector: 'app-offers',
  standalone: true,
  imports: [],
  templateUrl: './offers.component.html',
  styleUrl: './offers.component.css',
})
export class OffersComponent extends GenericComponent implements OnInit {
  public offers: Offer[] = [];

  public ngOnInit(): void {
    void this.apiRestService.getOffers().then((offers) => {
      if (offers.success) {
        this.offers = this.mapOfferFromApiResponse(offers.data.offers);
        this.isInLoading = false;
      }
    });
  }

  private mapOfferFromApiResponse(offers: ApiOffer[]): Offer[] {
    return offers.map((offer: ApiOffer) => {
      return {
        startAt: offer.start_at,
        endAt: offer.end_at,
        offer: offer.offer,
        offerType: offer.offer_type,
        serverType: offer.server_type,
        worldType: offer.world_type,
        isActive: this.isActiveOffer(offer.start_at, offer.end_at),
      };
    });
  }

  private isActiveOffer(startAt: string, endAt: string): boolean {
    const now = new Date();
    const startDate = new Date(startAt);
    const endDate = new Date(endAt);
    return now >= startDate && now <= endDate;
  }
}
