import cors from "cors";
import express from "express";
import { spawn } from "node:child_process";
import { z } from "zod";
import { listDesigns, saveDesign } from "./designStore.js";
import { buildSitlPlan, generateParamContent, getSystemStatus } from "./sitl.js";

const app = express();
const port = Number(process.env.PORT || 4310);
const activeProcesses = new Map();

const designSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  settings: z.record(z.unknown())
});

const locateSchema = z.object({
  simVehiclePath: z.string().optional()
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/system", async (_request, response, next) => {
  try {
    response.json(await getSystemStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/sitl/locate", async (request, response, next) => {
  try {
    const { simVehiclePath } = locateSchema.parse(request.body);
    response.json(await getSystemStatus(simVehiclePath));
  } catch (error) {
    next(error);
  }
});

app.get("/api/designs", async (_request, response, next) => {
  try {
    response.json({ designs: await listDesigns() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/designs", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json({ design: await saveDesign(design) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/params", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    const fileName = `${design.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "uav-design"}.param`;
    response.json({ fileName, content: generateParamContent(design) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sitl/plan", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json({ plan: await buildSitlPlan(design) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sitl/launch", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    const plan = await buildSitlPlan(design);

    if (!plan.available) {
      response.status(409).json({ error: "sim_vehicle.py was not found. Generate the plan and run it manually after installing ArduPilot SITL." });
      return;
    }

    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: process.env,
      windowsHide: true
    });

    activeProcesses.set(child.pid, child);
    child.once("exit", () => {
      activeProcesses.delete(child.pid);
    });

    response.json({ pid: child.pid, plan });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sitl/processes", (_request, response) => {
  response.json({ processes: Array.from(activeProcesses.keys()) });
});

app.delete("/api/sitl/processes/:pid", (request, response) => {
  const pid = Number(request.params.pid);
  const child = activeProcesses.get(pid);
  if (!child) {
    response.status(404).json({ error: "Process not found" });
    return;
  }
  child.kill("SIGTERM");
  activeProcesses.delete(pid);
  response.json({ stopped: pid });
});

app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: error.errors.map((entry) => entry.message).join("; ") });
    return;
  }

  response.status(500).json({ error: error instanceof Error ? error.message : "Unknown server error" });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`ArduPilot UAV Lab API listening on http://127.0.0.1:${port}`);
});
