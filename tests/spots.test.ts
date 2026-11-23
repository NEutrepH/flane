import { describe, expect, it } from 'vitest';
import { isOperator } from '../src/data/spots';

describe('tri des spots', () => {
  it('écarte les prestataires (bateaux, visites guidées, location)', () => {
    for (const name of ['Rederij Stiphout', 'F(r)ee Tours by City Sights Maastricht', 'Bike Tours Amsterdam', 'VVV Maastricht', 'Fietsverhuur Centrum', 'Visites guidées du Vieux-Lyon']) {
      expect(isOperator(name), name).toBe(true);
    }
  });

  it('garde les vrais lieux, même quand leur nom ressemble à un mot piège', () => {
    for (const name of ['Fort Sint Pieter', 'Maastricht Underground Kazematten Waldeck', 'Cathédrale Saint-Gatien de Tours', 'Tour Eiffel', 'Sint Servaasbrug', 'Brouwerij Bosch']) {
      expect(isOperator(name), name).toBe(false);
    }
  });
});
