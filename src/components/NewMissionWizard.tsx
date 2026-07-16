import { Check, ChevronLeft, ChevronRight, Cpu, MapPinned, Plane, Rotate3D, ShieldCheck, Truck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { airframesForVehicle, airframeLabel } from "../domain/airframes";
import {
  defaultFrameForVehicle,
  defaultNewMissionDraft,
  missionProfile,
  missionProfiles,
  type MissionSystemId,
  type NewMissionDraft
} from "../domain/missionTemplates";
import type { SimulationSettings } from "../domain/design";

type WizardStep = 0 | 1 | 2;

const stepLabels = ["Mission", "Airframe", "Systems"] as const;
const systemOptions: Array<{ id: MissionSystemId; label: string; description: string }> = [
  { id: "camera", label: "Imaging payload", description: "Camera, isolated payload mount, and stabilized gimbal." },
  { id: "companion-computer", label: "Mission computer", description: "Onboard compute and MAVLink autonomy link." },
  { id: "rangefinder", label: "Rangefinder", description: "Height and obstacle-distance sensing." },
  { id: "optical-flow", label: "Optical flow", description: "GPS-denied local motion sensing." },
  { id: "rc-receiver", label: "Pilot control receiver", description: "Manual control and recovery link." },
  { id: "parachute", label: "Recovery parachute", description: "Emergency recovery hardware and trigger path." }
];

const vehicleOptions: Array<{
  id: SimulationSettings["vehicle"];
  label: string;
  description: string;
  icon: typeof Rotate3D;
}> = [
  { id: "ArduCopter", label: "Multirotor", description: "Hover, vertical takeoff, and precise low-speed work.", icon: Rotate3D },
  { id: "ArduPlane", label: "Fixed wing", description: "Efficient range and endurance for larger areas.", icon: Plane },
  { id: "Rover", label: "Rover", description: "Ground navigation, sensing, and autonomy experiments.", icon: Truck }
];

interface NewMissionWizardProps {
  initialStep?: WizardStep;
  onCancel: () => void;
  onCreate: (draft: NewMissionDraft) => void;
  onStepChange?: (step: WizardStep) => void;
}

export function NewMissionWizard({ initialStep = 0, onCancel, onCreate, onStepChange }: NewMissionWizardProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [draft, setDraft] = useState<NewMissionDraft>(() => defaultNewMissionDraft());
  const [error, setError] = useState("");
  const frames = useMemo(() => airframesForVehicle(draft.vehicle), [draft.vehicle]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const moveToStep = (next: WizardStep) => {
    setError("");
    setStep(next);
    onStepChange?.(next);
  };

  const validateMission = () => {
    if (!draft.projectName.trim()) {
      setError("Enter a mission or project name.");
      return false;
    }
    if (!draft.objective.trim()) {
      setError("Describe the mission objective before continuing.");
      return false;
    }
    if (draft.distanceKm <= 0 || draft.altitudeM < 0) {
      setError("Mission distance must be greater than zero and altitude cannot be negative.");
      return false;
    }
    return true;
  };

  const next = () => {
    if (step === 0 && !validateMission()) return;
    moveToStep(Math.min(2, step + 1) as WizardStep);
  };

  const chooseProfile = (profileId: NewMissionDraft["profile"]) => {
    const profile = missionProfile(profileId);
    setDraft((current) => ({
      ...current,
      profile: profile.id,
      objective: profile.objective,
      distanceKm: profile.distanceKm,
      altitudeM: profile.altitudeM,
      systems: [...profile.systems]
    }));
    setError("");
  };

  const chooseVehicle = (vehicle: SimulationSettings["vehicle"]) => {
    setDraft((current) => ({ ...current, vehicle, frame: defaultFrameForVehicle(vehicle) }));
  };

  const toggleSystem = (system: MissionSystemId) => {
    setDraft((current) => ({
      ...current,
      systems: current.systems.includes(system) ? current.systems.filter((candidate) => candidate !== system) : [...current.systems, system]
    }));
  };

  return (
    <dialog
      ref={dialogRef}
      className="mission-wizard"
      aria-labelledby="mission-wizard-title"
      aria-describedby="mission-wizard-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 2) next();
          else if (validateMission()) onCreate(draft);
        }}
      >
        <header className="mission-wizard-header">
          <div>
            <small>New workspace</small>
            <h1 id="mission-wizard-title">Start with the mission</h1>
            <p id="mission-wizard-description">Define the goal, choose an airframe, then load a complete electrical, wiring, mechanical, avionics, and safety baseline.</p>
          </div>
          <button type="button" className="mission-wizard-close" onClick={onCancel} aria-label="Cancel new mission">
            <X size={20} />
          </button>
        </header>

        <nav className="mission-wizard-steps" aria-label="New mission steps">
          {stepLabels.map((label, index) => (
            <button
              type="button"
              key={label}
              className={index === step ? "active" : index < step ? "complete" : ""}
              aria-current={index === step ? "step" : undefined}
              onClick={() => index <= step && moveToStep(index as WizardStep)}
              disabled={index > step}
            >
              <span>{index < step ? <Check size={15} /> : index + 1}</span>
              {label}
            </button>
          ))}
        </nav>

        <section className="mission-wizard-body">
          {step === 0 ? (
            <div className="mission-step-content">
              <label className="mission-field mission-name-field">
                <span>Mission / project name</span>
                <input autoFocus value={draft.projectName} onChange={(event) => setDraft({ ...draft, projectName: event.target.value })} />
              </label>
              <fieldset>
                <legend>Mission profile</legend>
                <div className="mission-profile-grid">
                  {missionProfiles.map((profile) => (
                    <label key={profile.id} className={draft.profile === profile.id ? "selected" : ""}>
                      <input type="radio" name="mission-profile" checked={draft.profile === profile.id} onChange={() => chooseProfile(profile.id)} />
                      <MapPinned size={18} />
                      <span><strong>{profile.label}</strong><small>{profile.summary}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="mission-field">
                <span>Objective</span>
                <textarea rows={3} value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} />
              </label>
              <div className="mission-field-grid">
                <label className="mission-field">
                  <span>Environment</span>
                  <select value={draft.environment} onChange={(event) => setDraft({ ...draft, environment: event.target.value as NewMissionDraft["environment"] })}>
                    <option value="outdoor">Outdoor</option>
                    <option value="indoor">Indoor / GPS denied</option>
                    <option value="mixed">Mixed environment</option>
                  </select>
                </label>
                <label className="mission-field">
                  <span>Route distance <small>km</small></span>
                  <input type="number" min={0.1} max={1000} step={0.1} value={draft.distanceKm} onChange={(event) => setDraft({ ...draft, distanceKm: Number(event.target.value) })} />
                </label>
                <label className="mission-field">
                  <span>Target altitude <small>m</small></span>
                  <input type="number" min={0} max={10000} value={draft.altitudeM} onChange={(event) => setDraft({ ...draft, altitudeM: Number(event.target.value) })} />
                </label>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="mission-step-content">
              <fieldset>
                <legend>Vehicle family</legend>
                <div className="vehicle-choice-grid">
                  {vehicleOptions.map((vehicle) => {
                    const Icon = vehicle.icon;
                    return (
                      <label key={vehicle.id} className={draft.vehicle === vehicle.id ? "selected" : ""}>
                        <input type="radio" name="vehicle" checked={draft.vehicle === vehicle.id} onChange={() => chooseVehicle(vehicle.id)} />
                        <Icon size={26} />
                        <span><strong>{vehicle.label}</strong><small>{vehicle.description}</small></span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <fieldset>
                <legend>Airframe</legend>
                <div className="airframe-choice-grid">
                  {frames.map((frame) => (
                    <label key={frame.value} className={draft.frame === frame.value ? "selected" : ""}>
                      <input type="radio" name="airframe" checked={draft.frame === frame.value} onChange={() => setDraft({ ...draft, frame: frame.value })} />
                      <span><strong>{frame.label}</strong><small>{frame.description}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="mission-step-content">
              <div className="baseline-banner">
                <ShieldCheck size={22} />
                <span><strong>Engineering baseline included</strong><small>Airframe, landing gear, flight controller, protected power path, PDB, power module, documented wiring harness, GNSS, compass, telemetry, status alert, and {draft.vehicle === "Rover" ? "ground-drive provisions" : `${airframeLabel(draft.frame)} propulsion`}.</small></span>
              </div>
              <fieldset>
                <legend>Mission systems</legend>
                <div className="mission-system-grid">
                  {systemOptions.map((system) => (
                    <label key={system.id} className={draft.systems.includes(system.id) ? "selected" : ""}>
                      <input type="checkbox" checked={draft.systems.includes(system.id)} onChange={() => toggleSystem(system.id)} />
                      <Cpu size={18} />
                      <span><strong>{system.label}</strong><small>{system.description}</small></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <section className="mission-review-card">
                <small>Ready to create</small>
                <strong>{draft.projectName}</strong>
                <span>{missionProfile(draft.profile).label} · {draft.vehicle} · {airframeLabel(draft.frame)}</span>
                <p>{draft.objective}</p>
              </section>
            </div>
          ) : null}
          <p className="mission-wizard-error" role="alert" aria-live="polite">{error}</p>
        </section>

        <footer className="mission-wizard-footer">
          <button type="button" className="wizard-cancel" onClick={onCancel}>Cancel</button>
          <div>
            {step > 0 ? <button type="button" className="wizard-back" onClick={() => moveToStep((step - 1) as WizardStep)}><ChevronLeft size={17} />Back</button> : null}
            <button type="submit" className="wizard-primary">
              {step < 2 ? <>Next<ChevronRight size={17} /></> : <><Check size={17} />Create workspace</>}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
