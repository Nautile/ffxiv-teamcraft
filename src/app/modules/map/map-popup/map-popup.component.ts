import {Component, Inject, OnInit} from '@angular/core';
import {MapService} from '../map.service';
import {MapData} from '../map-data';
import {MAT_DIALOG_DATA} from '@angular/material';
import {Observable} from 'rxjs/Observable';

@Component({
    selector: 'app-map-popup',
    templateUrl: './map-popup.component.html',
    styleUrls: ['./map-popup.component.scss']
})
export class MapPopupComponent implements OnInit {

    mapData: Observable<MapData>;

    constructor(@Inject(MAT_DIALOG_DATA) public data: { coords: { x: number, y: number }, id: number }, private mapService: MapService) {
    }

    ngOnInit() {
        this.mapData = this.mapService.getMapById(this.data.id).publishReplay(1).refCount();
    }

}
