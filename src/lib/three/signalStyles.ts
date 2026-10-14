import type { SignalKind } from "../../domain/design";

export const threeSignalStyles: Record<SignalKind, { color: string; label: string }> = {
  power: { color: "#f59e0b", label: "Power" },
  pwm: { color: "#60a5fa", label: "PWM" },
  uart: { color: "#2dd4bf", label: "UART" },
  i2c: { color: "#4ade80", label: "I2C" },
  can: { color: "#94a3b8", label: "CAN" },
  analog: { color: "#c084fc", label: "Analog" },
  gpio: { color: "#84cc16", label: "GPIO" },
  video: { color: "#f472b6", label: "Video" },
  mount: { color: "#a8a29e", label: "Mount" },
  telemetry: { color: "#22d3ee", label: "Telemetry" }
};

