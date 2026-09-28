import { Venue, VenueIndexMap } from './types';


export function createVenueIndexMap(venues: Venue[]): VenueIndexMap {
  const map: VenueIndexMap = new Map();
  for (let i = 0; i < venues.length; i++) {
    map.set(venues[i].id, i);
  }
  return map;
}



