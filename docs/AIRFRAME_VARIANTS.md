# Airframe variants

The Airframe layout catalog includes seven fixed-wing concepts and six Rover concepts. Existing `fixed-wing`, `rover`, and multirotor keys remain valid in `.saq` workspaces. New Mission preserves the chosen variant, creates the corresponding drive channels, and wires control surfaces or steering servos.

| Family | Model | Workspace key | ArduPilot SITL frame |
| --- | --- | --- | --- |
| Fixed wing | Conventional | `fixed-wing` | `plane` |
| Fixed wing | High-wing Trainer | `fixed-wing-trainer` | `plane` |
| Fixed wing | Flying Wing / Elevon | `fixed-wing-flying-wing` | `plane-elevon` |
| Fixed wing | V-tail Survey Plane | `fixed-wing-vtail` | `plane-vtail` |
| Fixed wing | Motor Glider / Soaring | `fixed-wing-glider` | `plane-soaring` |
| Fixed wing | Twin-boom Pusher | `fixed-wing-twin-boom` | `plane` |
| Fixed wing | QuadPlane Lift + Cruise | `quadplane` | `quadplane` |
| Rover | Four-wheel steering | `rover` | `rover` |
| Rover | Off-road Buggy | `rover-buggy` | `rover` |
| Rover | Skid-steer 4WD | `rover-skid` | `rover-skid` |
| Rover | Tracked Crawler | `rover-tracked` | `rover-skid` |
| Rover | Six-wheel Explorer | `rover-6x6` | `rover-skid` |
| Rover | Two-wheel Balance Bot | `rover-balancebot` | `balancebot` |

These are generic design presets, with illustrative dimensions and component ratings that users can edit. Shape changes do not update aerodynamic coefficients, tire or track contact, suspension, or simulator mass. Trainer and twin-boom presets use standard Plane dynamics; buggy uses standard Rover; tracked and six-wheel concepts use skid-steering dynamics. Simulator model names are checked against the official [ArduPilot vehicle catalog](https://github.com/ArduPilot/ardupilot/blob/master/Tools/autotest/pysim/vehicleinfo.json).

QuadPlane templates contain four lift motors and one cruise motor. Conventional Rover templates contain one drive channel and a steering servo; differential-drive variants contain left and right drive channels. Motor `propulsionRole` distinguishes lift, cruise, and ground drive. Rover engineering checks use output torque instead of aircraft thrust. Control servos have power, PWM, and mounting validation and contribute to the estimated 5 V power budget. Preset servos receive a regulated power-module connection.

`node --test server/airframes.test.js` checks browser/server catalog agreement, native simulator mappings, legacy aliases, variant retention, propulsion counts, valid connection ports, servo validation and power loads, and ground-drive ratings. These regressions validate configuration behavior; they do not claim actual flight or terrain performance for every preset.
