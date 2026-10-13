/** Zambia delivery carriers + province fees (ZMW). */

export const ZAMBIA_PROVINCES = [
  { id: 'Lusaka', label: 'Lusaka' },
  { id: 'Copperbelt', label: 'Copperbelt' },
  { id: 'Central', label: 'Central' },
  { id: 'Southern', label: 'Southern' },
  { id: 'Eastern', label: 'Eastern' },
  { id: 'Western', label: 'Western' },
  { id: 'Northern', label: 'Northern' },
  { id: 'Luapula', label: 'Luapula' },
  { id: 'Muchinga', label: 'Muchinga' },
  { id: 'NorthWestern', label: 'North-Western' },
] as const;

export type ZambiaProvinceId = (typeof ZAMBIA_PROVINCES)[number]['id'];

type ProvinceFees = Record<ZambiaProvinceId, number>;

export const deliveryCarriers: Array<{ name: string; provinces: ProvinceFees }> = [
  {
    name: 'Yango',
    provinces: {
      Lusaka: 30,
      Copperbelt: 50,
      Central: 40,
      Southern: 45,
      Eastern: 55,
      Western: 60,
      Northern: 50,
      Luapula: 55,
      Muchinga: 65,
      NorthWestern: 70,
    },
  },
  {
    name: 'Plantnium',
    provinces: {
      Lusaka: 35,
      Copperbelt: 80,
      Central: 45,
      Southern: 50,
      Eastern: 60,
      Western: 65,
      Northern: 55,
      Luapula: 60,
      Muchinga: 70,
      NorthWestern: 75,
    },
  },
  {
    name: 'Fedex',
    provinces: {
      Lusaka: 40,
      Copperbelt: 60,
      Central: 50,
      Southern: 55,
      Eastern: 65,
      Western: 70,
      Northern: 60,
      Luapula: 65,
      Muchinga: 75,
      NorthWestern: 80,
    },
  },
  {
    name: 'Mercury',
    provinces: {
      Lusaka: 25,
      Copperbelt: 45,
      Central: 35,
      Southern: 40,
      Eastern: 50,
      Western: 55,
      Northern: 45,
      Luapula: 50,
      Muchinga: 60,
      NorthWestern: 65,
    },
  },
];

export function getDeliveryFee(
  carrier: string,
  province: string,
  isShopOwner?: boolean,
  shopCity?: string,
  clientCity?: string
): number {
  if (isShopOwner && shopCity && clientCity && shopCity.trim().toLowerCase() === clientCity.trim().toLowerCase()) {
    return 10;
  }
  const foundCarrier = deliveryCarriers.find((c) => c.name === carrier);
  if (!foundCarrier) return 0;
  return Number(foundCarrier.provinces[province as ZambiaProvinceId] ?? 0) || 0;
}

export function provinceLabel(provinceId: string): string {
  return ZAMBIA_PROVINCES.find((p) => p.id === provinceId)?.label || provinceId;
}
