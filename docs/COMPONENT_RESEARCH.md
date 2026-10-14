# UAV component reference

Checked **2026-10-09**. The component catalog uses these sources to populate selectable starting points. Values are engineering inputs, not a substitute for the exact revision's datasheet, wiring, thermal, or regulatory review.

| Component | Source-backed option added | Data carried into the preset | Source |
| --- | --- | --- | --- |
| Flight controller | Pixhawk 6C | STM32H743, 6 V maximum input, 59.3 g aluminum / 34.6 g plastic variant | [Holybro Pixhawk 6C](https://holybro.com/collections/flight-controllers/products/pixhawk-6c) |
| Power module | PM07 14S | 2–14S, 90 A PCB continuous, 140 A PCB burst, 5.2 V/3 A output, 43.8 g | [Holybro PM07](https://holybro.com/collections/power-modules-pdbs/products/pixhawk-4-power-module-pm07) |
| ESC | XRotor 40A 6S BLDC | 2–6S LiPo, 40 A continuous, 60 A peak, no BEC | [Hobbywing XRotor 40A](https://a.hobbywing.com/en/products/xrotor-40a122) |
| GNSS | H-RTK F9P DroneCAN Rover | ZED-F9P, DroneCAN 1 Mbit/s, RTK up to 8 Hz, 4.75–5.25 V, approximately 250 mA | [Holybro DroneCAN F9P specification](https://docs.holybro.com/gps-and-rtk-system/f9p-h-rtk-series/dronecan-f9p/specification) |
| Compass | DroneCAN RM3100 | External industrial-grade compass option; interface and mounting remain installation choices | [Holybro RM3100 specification](https://docs.holybro.com/gps-and-rtk-system/h-rtk-neo-f9p-series-rm3100-compass/specification) |
| Rangefinder | Benewake TFmini-S | 0.1–12 m, UART/I2C/I/O, 5 V, up to 1000 Hz, 5 g, 42 × 15 × 16 mm | [Benewake TFmini-S](https://ai.benewake.com/en/products/tfmini-s/) |
| Telemetry | RFDesign RFD900x | 902–928 MHz, diversity, up to 500 kbps, 5 V nominal, 14 g | [RFDesign RFD900x data sheet](https://files.rfdesign.com.au/Files/documents/RFD900x%20DataSheet%20V1.1.pdf) |
| Battery | Tattu and MaxAmps packs | Chemistry-aware voltage, total capacity, C/current limits, dimensions, connectors, and measured mass | [battery research](./BATTERY_RESEARCH.md) |

## Selection and validation rules

- Selecting a product copies its published values into the design, but the exact hardware revision and connector variant still need confirmation before assembly.
- A connector name does not imply a current rating. Current is capped only when a pack, connector, wiring harness, or distribution device has an explicit current limit.
- A GPS update-rate field describes the configured output rate; it does not claim that every navigation mode (for example RTK) supports that rate.
- A rangefinder's maximum range is a sensor specification under stated reflectivity and lighting conditions. It does not establish terrain-following or obstacle-avoidance safety by itself.
- Regional radio frequency and transmit-power rules apply to telemetry and RC selections. The catalog intentionally does not infer legal operation from the selected band.

