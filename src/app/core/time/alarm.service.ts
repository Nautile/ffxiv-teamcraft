import {Injectable} from '@angular/core';
import {EorzeanTimeService} from './eorzean-time.service';
import {Alarm} from './alarm';
import {Subscription} from 'rxjs/Subscription';
import {ListRow} from '../../model/list/list-row';
import {SettingsService} from '../../pages/settings/settings.service';
import {MatDialog, MatSnackBar} from '@angular/material';
import {LocalizedDataService} from '../data/localized-data.service';
import {TranslateService} from '@ngx-translate/core';
import {Observable} from 'rxjs/Observable';
import {Timer} from 'app/core/time/timer';
import {MapPopupComponent} from '../../modules/map/map-popup/map-popup.component';
import {BellNodesService} from '../data/bell-nodes.service';
import {PushNotificationsService} from 'ng-push';

@Injectable()
export class AlarmService {

    private static LOCALSTORAGE_KEY = 'alarms';

    private _alarms: Map<Alarm, Subscription> = new Map<Alarm, Subscription>();

    constructor(private etime: EorzeanTimeService, private settings: SettingsService, private snack: MatSnackBar,
                private localizedData: LocalizedDataService, private translator: TranslateService, private dialog: MatDialog,
                private bellNodesService: BellNodesService, private pushNotificationsService: PushNotificationsService) {
        this.loadAlarms();
    }

    /**
     * Registers a given item and creates an alarm for it.
     * @param {ListRow} item
     */
    public register(item: ListRow): void {
        this.generateAlarms(item).forEach(alarm => {
            this.registerAlarms(alarm);
        });
    }

    /**
     * Determines if a given item has an activated alarm or not.
     * @returns {boolean}
     * @param itemId
     */
    public hasAlarm(itemId: number): boolean {
        let res = false;
        this._alarms.forEach((value, key) => {
            if (key.itemId === itemId) {
                res = true;
            }
        });
        return res;
    }

    /**
     * Unregisters a given item alarm by finding it, then unregisters the subscription, and finally deletes the entry from the alarms.
     * @param id
     */
    public unregister(id: number): void {
        this.getAlarms(id).forEach((alarm) => {
            this._alarms.get(alarm).unsubscribe();
            this._alarms.delete(alarm);
        });
        this.persistAlarms();
    }

    /**
     * Actual implementation of the registration of an alarm object.
     * @param {Alarm} alarms
     * @private
     */
    public registerAlarms(...alarms: Alarm[]): void {
        alarms.forEach(alarm => {
            this._alarms.set(alarm, this.etime.getEorzeanTime().subscribe(time => {
                if (time.getUTCHours() === this.substractHours(alarm.spawn, this.settings.alarmHoursBefore) && time.getUTCMinutes() === 0) {
                    this.playAlarm(alarm);
                }
            }));
        });
        this.persistAlarms();
    }

    /**
     * Gets alarm entries for a given item based on node spawns and uptime.
     * @param {ListRow} item
     * @private
     */
    public generateAlarms(item: ListRow): Alarm[] {
        const alarms: Alarm[] = [];
        if (item.gatheredBy === undefined) {
            if (item.reducedFrom !== undefined) {
                // If there's a way to get the item via reduction, use the item as base
                const nodes = [].concat
                    .apply([], item.reducedFrom
                        .map(reduction => {
                            if (reduction.obj !== undefined) {
                                return reduction.obj.i;
                            }
                            return reduction;
                        })
                        .map(reduction => this.bellNodesService.getNodesByItemId(reduction)));

                nodes.filter(node => node.time !== undefined)
                    .forEach(node => {
                        node.time.forEach(spawn => {
                            alarms.push({
                                spawn: spawn,
                                duration: node.uptime / 60,
                                itemId: node.itemId,
                                icon: node.icon,
                                slot: node.slot,
                                areaId: node.areaid,
                                coords: node.coords,
                                zoneId: node.zoneid,
                                type: this.getType(node),
                            });
                        });
                    });
                return alarms;
            }
            return [];
        }
        item.gatheredBy.nodes.forEach(node => {
            if (node.time !== undefined) {
                node.time.forEach(spawn => {
                    alarms.push({
                        spawn: spawn,
                        duration: node.uptime / 60,
                        itemId: item.id,
                        icon: item.icon,
                        slot: node.slot,
                        areaId: node.areaid,
                        coords: node.coords,
                        zoneId: node.zoneid,
                        type: this.getType(node),
                    });
                });
            }
        });
        return alarms;
    }


    getType(node: any): number {
        return ['Rocky Outcropping', 'Mineral Deposit', 'Mature Tree', 'Lush Vegetation'].indexOf(node.type);
    }

    /**
     * Plays the alarm (audio + snack).
     * @param {Alarm} alarm
     */
    private playAlarm(alarm: Alarm): void {
        const lastPlayed = localStorage.getItem('alarms:' + alarm.itemId);
        // Don't play the alarm if it was played less than a minute ago
        if (lastPlayed === null || Date.now() - +lastPlayed > 60000) {
            this.snack.open(this.translator.instant('ALARM.Spawned',
                {itemName: this.localizedData.getItem(alarm.itemId)[this.translator.currentLang]}),
                this.translator.instant('ALARM.See_on_map'),
                {duration: 5000})
                .onAction().subscribe(() => {
                this.dialog.open(MapPopupComponent, {data: {coords: {x: alarm.coords[0], y: alarm.coords[1]}, id: alarm.zoneId}});
            });
            const audio = new Audio(`/assets/audio/${this.settings.alarmSound}.mp3`);
            audio.loop = false;
            audio.volume = this.settings.alarmVolume;
            audio.play();
            this.pushNotificationsService.create(this.translator.instant('ALARM.Spawned',
                {itemName: this.localizedData.getItem(alarm.itemId)[this.translator.currentLang]}),
                {
                    icon: `https://www.garlandtools.org/db/icons/item/${alarm.icon}.png`,
                    sticky: false,
                    renotify: false,
                    body: `${this.localizedData.getPlace(alarm.zoneId)[this.translator.currentLang]} - ` +
                    `${this.localizedData.getPlace(alarm.areaId)[this.translator.currentLang]} ` +
                    (alarm.slot !== null ? `(${alarm.slot})` : '')
                }
            ).subscribe(() => {
            }, err => {
                // If there's an error, it means that we don't have permission, that's not a problem but we want to catch it.
            });
            localStorage.setItem('alarms:' + alarm.itemId, Date.now().toString());
        }
    }

    /**
     * Return the amount of minutes before the next alarm of the item.
     * @param {ListRow} item
     * @returns {Observable<number>}
     */
    public getTimers(item: ListRow): Observable<Timer[]> {
        return this.etime.getEorzeanTime().map(time => {
            const alarms = this.generateAlarms(item).reduce(function (rv, x) {
                (rv[x.type] = rv[x.type] || []).push(x);
                return rv;
            }, {});
            return Object.keys(alarms).map(key => {
                const alarm = this.closestAlarm(alarms[key], time);
                if (this._isSpawned(alarm, time)) {
                    const timer = this.getMinutesBefore(time, (alarm.spawn + alarm.duration) % 24);
                    return {
                        itemId: alarm.itemId,
                        display: this.getTimerString(this.etime.toEarthTime(timer)),
                        time: timer,
                        slot: alarm.slot,
                        zoneId: alarm.zoneId,
                        coords: alarm.coords, areaId: alarm.areaId,
                        type: alarm.type,
                        alarm: alarm,
                    };
                } else {
                    const timer = this.getMinutesBefore(time, alarm.spawn);
                    return {
                        itemId: alarm.itemId,
                        display: this.getTimerString(this.etime.toEarthTime(timer)),
                        time: timer,
                        slot: alarm.slot,
                        zoneId: alarm.zoneId,
                        coords: alarm.coords,
                        areaId: alarm.areaId,
                        type: alarm.type,
                        alarm: alarm,
                    };
                }
            });
        });
    }

    public getAlarmTimerString(alarm: Alarm, time: Date): string {
        let timer: number;
        if (this._isSpawned(alarm, time)) {
            timer = this.getMinutesBefore(time, (alarm.spawn + alarm.duration) % 24);
        } else {
            timer = this.getMinutesBefore(time, alarm.spawn)
        }
        return this.getTimerString(this.etime.toEarthTime(timer));
    }

    /**
     * Returns the closest alarm at a given time.
     * @param {Alarm[]} alarms
     * @param {Date} time
     * @returns {Alarm}
     */
    public closestAlarm(alarms: Alarm[], time: Date): Alarm {
        return alarms.sort((a, b) => {
            if (this._isSpawned(a, time)) {
                return -1;
            } else if (this._isSpawned(b, time)) {
                return 1;
            } else {
                return this.getMinutesBefore(time, a.spawn) > this.getMinutesBefore(time, b.spawn) ? 1 : -1;
            }
        })[0]
    }

    public isAlarmSpawned(alarm: Alarm, time: Date): boolean {
        return this._isSpawned(alarm, time);
    }

    /**
     * Formats a given timer to a string;
     * @param {number} timer
     * @returns {string}
     */
    public getTimerString(timer: number): string {
        const seconds = timer % 60;
        const minutes = Math.floor(timer / 60);
        return `${minutes}:${seconds < 10 ? 0 : ''}${seconds}`;
    }

    /**
     * Gets alarms for a given item.
     * @returns {Alarm[]}
     * @param id
     */
    private getAlarms(id: number): Alarm[] {
        const alarms: Alarm[] = [];
        this._alarms.forEach((value, key) => {
            if (key.itemId === id) {
                alarms.push(key);
            }
        });
        return alarms;
    }

    /**
     * Determines if a given alarm is spawned.
     * @param {Alarm} alarm
     * @param {Date} time
     * @returns {boolean}
     * @private
     */
    public _isSpawned(alarm: Alarm, time: Date): boolean {
        const spawn = alarm.spawn;
        let despawn = (spawn + alarm.duration) % 24;
        despawn = despawn === 0 ? 24 : despawn;
        return time.getUTCHours() >= spawn && time.getUTCHours() < despawn;
    }

    /**
     * Determines if a given node is spawned or not.
     * @param {ListRow} item
     * @returns {Observable<boolean>}
     */
    public isSpawned(item: ListRow): Observable<boolean> {
        return this.etime.getEorzeanTime().map(time => {
            let spawned = false;
            this.generateAlarms(item).forEach(alarm => {
                if (this._isSpawned(alarm, time)) {
                    spawned = true;
                }
            });
            return spawned;
        });
    }

    /**
     * Returns an observable of the alert state, for color purposes.
     * @returns {Observable<boolean>}
     * @param id
     */
    public isAlerted(id: number): Observable<boolean> {
        return this.etime.getEorzeanTime().map(time => {
            let alerted = false;
            this.getAlarms(id).forEach(alarm => {
                alerted = alerted || this.isAlarmAlerted(alarm, time);
            });
            return alerted;
        })
    }

    public isAlarmAlerted(alarm: Alarm, time: Date) {
        return time.getUTCHours() >= this.substractHours(alarm.spawn, this.settings.alarmHoursBefore) && time.getUTCHours() < alarm.spawn;
    }

    /**
     * Little helper to substract hours and cycle through a day if it's necessary.
     * @param {number} h1
     * @param {number} h2
     * @returns {number}
     */
    substractHours(h1: number, h2: number): number {
        let result = (h1 - h2) % 24;
        if (result < 0) {
            result += 24;
        }
        return result;
    }

    /**
     * Returns the amount of minutes before a given alarm.
     * @param {number} currentTime
     * @param hours
     * @param minutes
     * @returns {number}
     */
    public getMinutesBefore(currentTime: Date, hours: number, minutes = 0): number {
        // Convert 0 to 24 for spawn timers
        if (hours === 0) {
            hours = 24;
        }
        const resHours = hours - currentTime.getUTCHours();
        let resMinutes = resHours * 60 + minutes - currentTime.getUTCMinutes();
        let resSeconds = resHours * 3600 + minutes * 60 - currentTime.getUTCSeconds();
        if (resMinutes < 0) {
            resMinutes += 1440;
        }
        if (resSeconds < 0) {
            resSeconds += 360;
        }
        resMinutes += (resSeconds % 60) / 60;
        return resMinutes;
    }

    /**
     * Loads alarms fro the local storage of the browser.
     */
    private loadAlarms(): void {
        this.registerAlarms(...(JSON.parse(localStorage.getItem(AlarmService.LOCALSTORAGE_KEY)) || []));
    }

    /**
     * Persist the current alarms into browser's localstorage.
     */
    private persistAlarms(): void {
        localStorage.setItem(AlarmService.LOCALSTORAGE_KEY, JSON.stringify(Array.from(this._alarms.keys())));
    }

    /**
     * Gets a list of currently active alarms.
     * @returns {Alarm[]}
     */
    public get alarms(): Alarm[] {
        return Array.from(this._alarms.keys());
    }
}
