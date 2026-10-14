# Drone battery reference data

Checked **2026-10-09** using manufacturer product pages and linked manufacturer documentation. These are pack presets for design calculations; optional limits remain unspecified when the manufacturer does not publish them.

| Pack and primary source | Chemistry/configuration | Pack capacity | Nominal voltage | Continuous rating | Burst rating | Pack mass | Dimensions L × W × H | Connectors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [Tattu G-Tech 5200](https://www.genstattu.com/tattu-5200mah-14-8v-35c-4s1p-lipo-battery-pack-with-xt60-plug.html), TA-35C-5200-4S1P-XT60 | LiPo, 4S1P | 5200 mAh | 14.8 V | 35C | 70C | 436.5 g ±20 g | 133 × 45 × 33.5 mm | XT60; JST-XHR balance |
| [Tattu G-Tech 22000](https://genstattu.com/tattu-22-2v-30c-6s-22000mah-lipo-battery-with-xt90-s-plug-for-uav.html), TA-30C-22000-6S1P-XT90 | LiPo, 6S1P | 22000 mAh | 22.2 V | 30C | Unspecified in preset | 2460 g ±20 g | 206 × 91 × 61 mm | XT90-S in title; JST-XHR-7P balance |
| [Tattu G-Tech HV 17000](https://genstattu.com/tattu-22-8v-15c-6s-17000mah-lipo-battery-with-xt90-plug-for-uav.html), TA-15C-17000-6S1P-HV-XT90 | LiHV, 6S1P | 17000 mAh | 22.8 V | 15C | 30C | 1874 g ±20 g | 192 × 76 × 62 mm | XT90-S in title; JST-XHR-7P balance |
| [MaxAmps Li-ion 9000](https://maxamps.com/products/li-ion-9000-6s2p-21-6v-battery-pack), MA-9000-6s2p-Li-ion-Pack | Li-ion, 6S2P | 9000 mAh | 21.6 V | 90 A; equivalent 10C calculated | Unspecified in preset | 874 g | 129 × 44 × 78 mm | Customer-selected; exact connector unspecified |

## Calculation conventions

`capacityMah` is the **total pack capacity** printed by the manufacturer. `parallelCells` describes the configuration and does not multiply that capacity again. For example, the MaxAmps 6S2P pack remains 9 Ah and 194.4 Wh, rather than 18 Ah.

- Pack nominal voltage = series cells × nominal cell voltage.
- Pack full voltage = series cells × full cell voltage.
- Nominal energy in Wh = nominal pack voltage × pack capacity in Ah.
- C-derived continuous current = continuous C-rating × pack capacity in Ah.
- When published, a pack current limit or documented connector/wiring limit caps the C-derived current. A connector name alone does not establish a current limit.
- Burst ratings do not establish continuous current capability or a permitted burst duration.

Chemistry defaults are LiPo 3.7/4.2 V, LiHV 3.8/4.35 V, and Li-ion 3.6/4.2 V per cell (nominal/full). The [manufacturer's 6S HV series description](https://www.grepow.com/battery-news/tattu-6s-high-voltage-uav-drone-battery.html) identifies 22.8 V nominal packs and 4.35 V high-voltage cells. MaxAmps publishes 21.6 V nominal and 25.2 V maximum for its 6S Li-ion pack.

The lab's low/critical cell defaults of 3.5/3.3 V are editable calculation assumptions, not manufacturer-specific battery limits. Zero in a voltage override selects the chemistry or lab default. Zero in optional current, charge, burst, or dimension fields means unspecified, rather than a measured zero capability.

## Manufacturer ambiguities retained in the presets

Tattu's 22000 and 17000 product titles identify XT90-S connectors, while their specification tables shorten the name to XT90. Presets follow the product title without assigning a connector current rating. The 22000 page also contains an isolated 150C burst metadata value that is not corroborated by its main specifications; the preset leaves burst capability unspecified.

The LiHV 17000 preset uses the cited GensTattu product page's mass and dimensions consistently. [Grepow's corresponding product page](https://www.grepow.com/uav-battery/tattu-g-tech-6s-17000mah-22-8v-15c-lipo-drone-battery-for-uav.html) gives 1857 g and 192 × 77 × 60 mm, which differ from the cited regional listing. These alternatives are not mixed into the preset.

MaxAmps' current canonical product page gives 874 g and 129 × 44 × 78 mm. Its [linked manufacturer PDF](https://cdn.shopify.com/s/files/1/0609/0811/0079/files/MaxAmps_9000_6S2P_Li-ion_Data_Sheet.pdf?v=1711472113) instead gives 840 g and 127 × 43 × 75 mm. The preset follows the current product page for installation dimensions and mass; both sources agree on 6S2P, 9 Ah, 21.6/25.2 V, 194.4 Wh, and 90 A continuous discharge. That C-rating is derived as 90 A ÷ 9 Ah = 10C.
