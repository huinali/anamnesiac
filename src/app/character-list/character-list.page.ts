
import * as _ from 'lodash';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { LocalStorage, LocalStorageService } from 'ngx-webstorage';

import { ModalController, PopoverController } from '@ionic/angular';
import { Component, OnInit, OnDestroy, NgZone, ElementRef } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';

import { DataService } from '../data.service';
import { Character } from '../models/character';
import { CharacterSortPopover, CharacterModal } from './character-list.ui';

@Component({
  selector: 'app-character-list',
  templateUrl: 'character-list.page.html',
  styleUrls: ['character-list.page.scss']
})
export class CharacterListPage implements OnInit, OnDestroy {

  public isFiltered: boolean;

  public isError: boolean;
  public allCharacters: Character[] = [];

  @LocalStorage()
  public sorting: 'tier'|'alpha'|'weapon';

  @LocalStorage()
  public show34: boolean;

  public tierSortedCharacters: { [key: string]: Character[] } = {};
  public allTiers: string[] = [];

  public alphaSortedCharacters: Character[] = [];

  public weaponSortedCharacters: { [key: string]: Character[] } = {};
  public allWeapons: string[] = [];

  public showSearch: boolean;
  public searchValue = '';

  private storage$: Subscription;
  private router$: Subscription;
  private character$: Subscription;

  private region: 'gl'|'jp';

  constructor(
    private dataService: DataService,
    private localStorage: LocalStorageService,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private popoverCtrl: PopoverController,
    private modalCtrl: ModalController,
    private ngZone: NgZone,
    private elementRef: ElementRef
  ) {}

  ngOnInit() {
    if(!this.sorting) { this.sorting = 'alpha'; }

    this.storage$ = this.localStorage.observe('isJP').subscribe(val => {
      this.updateRegionBasedOn(val);
    });

    this.router$ = this.router.events
      .pipe(
        filter(x => x instanceof NavigationEnd)
      )
      .subscribe((x: NavigationEnd) => {
        if(!_.includes(x.url, 'characters')) { return; }
        this.updateRegionBasedOn(this.localStorage.retrieve('isJP'));
        this.updateCharacterListOutsideZone();
      });

    this.character$ = this.dataService.characters$.subscribe(chars => {
      this.allCharacters = chars;
      this.updateRegionBasedOn(this.localStorage.retrieve('isJP'));
      this.updateCharacterListOutsideZone();
    });
  }

  ngOnDestroy() {
    this.storage$.unsubscribe();
    this.router$.unsubscribe();
    this.character$.unsubscribe();
  }

  private updateCharacterListOutsideZone() {
    this.ngZone.runOutsideAngular(() => {
      const res = this.getCharacterUpdateList();

      this.ngZone.run(() => {

        if(!_.isUndefined(res.isError)) {
          this.isError = res.isError;
          if(this.isError) { return; }
        }

        this.allTiers = res.allTiers;
        this.allWeapons = res.allWeapons;

        this.alphaSortedCharacters = res.alphaSortedCharacters;
        this.tierSortedCharacters = res.tierSortedCharacters;
        this.weaponSortedCharacters = res.weaponSortedCharacters;

        if(this.getPreviouslyLoadedChar()) {
          this.loadCharacterModal(this.getPreviouslyLoadedChar());
        }
      });
    });
  }

  private updateRegionBasedOn(val: boolean) {
    this.region = val ? 'jp' : 'gl';

    this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {
        filter: this.getCurrentFilter(),
        region: this.region,
        char: this.getPreviouslyLoadedChar()
      }
    });
  }

  public loadCharacter(char: Character) {

    if(char.name === this.getPreviouslyLoadedChar()) {
      this.loadCharacterModal(char.name);
      return;
    }

    this.router.navigate([], {
      relativeTo: this.activatedRoute,
      queryParams: {
        filter: this.getCurrentFilter(),
        region: this.region,
        char: char.name
      }
    });
  }

  // UI MODIFYING FUNCTIONS
  public async loadCharacterModal(name: string) {
    const character = _.find(this.allCharacters, { name, cat: this.region });

    if(!character) { return; }

    const modal = await this.modalCtrl.create({
      component: CharacterModal,
      componentProps: {
        character,
        weapon: this.dataService.properifyItem(character.weapon)
      }
    });

    modal.onDidDismiss().then(() => {
      this.router.navigate([], {
        relativeTo: this.activatedRoute,
        queryParams: {
          filter: this.getCurrentFilter(),
          region: this.region
        }
      });
    });

    await modal.present();
  }

  public async openSort(ev) {
    const popover = await this.popoverCtrl.create({
      component: CharacterSortPopover,
      event: ev,
      translucent: true
    });

    popover.onDidDismiss().then(({ data }) => {
      if(!data) { return; }
      if(data === 'show34') {
        this.show34 = !this.show34;
        this.updateCharacterListOutsideZone();
        return;
      }
      this.sorting = <'tier'|'alpha'|'weapon'>data;
      this.updateCharacterListOutsideZone();
    });

    return await popover.present();
  }

  public toggleSearch() {
    this.showSearch = !this.showSearch;

    if(!this.showSearch) {
      this.closeSearch();
    } else {
      setTimeout(() => {
        this.elementRef.nativeElement.querySelector('input').focus();
      }, 500);
    }
  }

  public updateSearchValue(ev) {
    if(!ev.detail) {
      this.searchValue = '';
      return;
    }
    const str = ev.target.value;
    this.searchValue = str;
  }

  public closeSearch() {
    this.showSearch = false;
    this.searchValue = '';
  }

  // CHARACTER LIST SORTING
  private getCharacterUpdateList() {
    let arr = this.allCharacters;

    const curFilter = this.getCurrentFilter();

    if(!this.show34) {
      arr = arr.filter(x => x.star >= 5);
    }

    this.isFiltered = !!curFilter;
    if(curFilter) {
      arr = arr.filter(char => char.type === curFilter);
    }

    arr = arr.filter(char => char.cat === this.region);

    if(arr.length === 0) {
      return { isError: true };
    }

    // alpha sorting
    let alphaSortedCharacters = [];
    if(this.sorting === 'alpha') {
      alphaSortedCharacters = _.sortBy(arr, 'name');
    }

    // weapon sorting
    let weaponSortedCharacters = {};
    let allWeapons = [];

    if(this.sorting === 'weapon') {
      weaponSortedCharacters = _(arr)
        .sortBy('name')
        .groupBy('weapon')
        .value();

      allWeapons = _.sortBy(Object.keys(weaponSortedCharacters));
    }

    // tier sorting
    let tierSortedCharacters = {};
    let allTiers = [];

    if(this.sorting === 'tier') {
      tierSortedCharacters = _(arr)
        .sortBy([(char) => -Math.floor(char.rating), 'name'])
        .groupBy(char => {
          if(char.rating >= 10) { return 'Top Tier (10/10)'; }
          if(char.rating >= 8 && char.rating < 10) { return 'Great (8-9/10)'; }
          if(char.rating >= 6 && char.rating <  8) { return 'Good (6-7/10)'; }
          if(char.rating >= 4 && char.rating <  6) { return 'Average (4-5/10)'; }
          if(char.rating <= 0)                     { return 'Absolute Trash (0/10)'; }
          return 'Bad (1-3/10)';
        })
        .value();

      allTiers = _.sortBy(Object.keys(tierSortedCharacters), (tier) => {
        if(tier === 'Top Tier (10/10)')      { return 0; }
        if(tier === 'Great (8-9/10)')        { return 1; }
        if(tier === 'Good (6-7/10)')         { return 2; }
        if(tier === 'Average (4-5/10)')      { return 3; }
        if(tier === 'Bad (1-3/10)')          { return 4; }
        if(tier === 'Absolute Trash (0/10)') { return 5; }
        return 10;
      });
    }

    return {
      isError: false,
      alphaSortedCharacters,
      weaponSortedCharacters,
      allWeapons,
      tierSortedCharacters,
      allTiers
    };
  }

  private getCurrentFilter(): string {
    const parameters = new URLSearchParams(window.location.search);
    return parameters.get('filter');
  }

  private getPreviouslyLoadedChar(): string {
    const parameters = new URLSearchParams(window.location.search);
    return parameters.get('char');
  }
}
