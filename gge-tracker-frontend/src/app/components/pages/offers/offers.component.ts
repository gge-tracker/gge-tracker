import { Component, OnInit } from '@angular/core';
import { GenericComponent } from '@ggetracker-components/generic/generic.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-offers',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './offers.component.html',
  styleUrl: './offers.component.css',
})
export class OffersComponent extends GenericComponent implements OnInit {
  public offers: Record<string, any> = {};
  public selectedCategoryOffer: any[] = [];
  public categories: Record<string, number> = {};

  public ngOnInit(): void {
    void this.apiRestService.getOffers().then((offers) => {
      this.offers = offers;
      for (const category in this.offers) {
        if (this.offers.hasOwnProperty(category) && this.offers[category]?.data?.offers) {
          this.offers[category].data.offers = this.offers[category].data.offers.map((offer: any) => {
            return {
              ...offer,
              formattedPrice: (Number(offer.price) / 100).toFixed(2),
            };
          });
        }
      }
      for (const category in offers) {
        if (offers.hasOwnProperty(category) && offers[category].data?.offers?.length > 0) {
          this.categories[category] = offers[category].data?.offers?.length;
        }
      }
      this.isInLoading = false;
    });
  }

  public onCategoryChange(category: string): void {
    this.selectedCategoryOffer = this.offers[category].data.offers;
  }
}
