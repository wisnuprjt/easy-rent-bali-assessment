
import fs from "node:fs";
import path from "node:path";
import { Incident } from "./triage_engine";

// ============================================================
// 1. DISPATCH TYPES
// ============================================================

export type DispatchResult = {
  vehicle_id: string;
  type: string;
  delivered: boolean;
  attempts: number;
  channel: string;
  last_error?: string;
};

export type DispatcherDependencies = {
  deliver: (incident: Incident) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

// ============================================================
// 2. DEFAULT SIMULATION ADAPTER
// ============================================================

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

async function simulatedDeliver(_incident: Incident): Promise<void> {
  // Assessment mode:
  // Simulates successful notification delivery.
  // No external notification provider is contacted.
}

// ============================================================
// 3. DISPATCH WITH EXPONENTIAL BACKOFF
// ============================================================

export async function dispatchWithRetry(
  incident: Incident,
  maxAttempts = 4,
  dependencies: DispatcherDependencies = {
    deliver: simulatedDeliver,
    sleep,
    random: Math.random
  }
): Promise<DispatchResult> {

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("maxAttempts must be a positive integer.");
  }

  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await dependencies.deliver(incident);

      return {
        vehicle_id: incident.vehicle_id,
        type: incident.type,
        delivered: true,
        attempts: attempt,
        channel: "SIMULATED_DISPATCH"
      };

    } catch (error: unknown) {
      lastError =
        error instanceof Error
          ? error.message
          : "Unknown dispatch error";

      console.error(
        `[Dispatcher] Attempt ${attempt}/${maxAttempts} failed for vehicle ${incident.vehicle_id}: ${lastError}`
      );

      if (attempt < maxAttempts) {
        // Exponential backoff with a 30-second cap.
        const exponential = Math.min(
          30_000,
          500 * (2 ** (attempt - 1))
        );

        // Random jitter between 0 and 249 milliseconds.
        const jitter = Math.floor(
          dependencies.random() * 250
        );

        const delay = exponential + jitter;

        console.log(
          `[Dispatcher] Retrying in ${delay}ms...`
        );

        await dependencies.sleep(delay);
      }
    }
  }

  return {
    vehicle_id: incident.vehicle_id,
    type: incident.type,
    delivered: false,
    attempts: maxAttempts,
    channel: "SIMULATED_DISPATCH",
    last_error: lastError
  };
}

// ============================================================
// 4. DISPATCH ALL INCIDENTS
// ============================================================

async function main(): Promise<void> {
  const input = path.resolve(
    "output/incident_reconciliation.json"
  );

  const output = path.resolve(
    "output/dispatch_results.json"
  );

  if (!fs.existsSync(input)) {
    throw new Error(
      "Run npm run fleet:triage before npm run fleet:dispatch."
    );
  }

  const data = JSON.parse(
    fs.readFileSync(input, "utf8")
  );

  if (!Array.isArray(data.incidents)) {
    throw new Error(
      "Invalid incident reconciliation format."
    );
  }

  const results: DispatchResult[] = [];

  for (const incident of data.incidents as Incident[]) {
    const result = await dispatchWithRetry(incident);

    results.push(result);
  }

  fs.mkdirSync(
    path.dirname(output),
    { recursive: true }
  );

  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        dispatch_mode: "SIMULATED",
        dispatch_count: results.length,
        successful: results.filter(r => r.delivered).length,
        failed: results.filter(r => !r.delivered).length,
        results
      },
      null,
      2
    )
  );

  console.log("\n========================================");
  console.log("FLEET DISPATCH SUMMARY");
  console.log("========================================");

  console.log(`Total incidents: ${results.length}`);

  console.log(
    `Successful simulations: ${results.filter(r => r.delivered).length}`
  );

  console.log(
    `Failed dispatches: ${results.filter(r => !r.delivered).length}`
  );

  console.log(`Output: ${output}`);
  console.log("Mode: SIMULATED (no external notification sent)");
}

// ============================================================
// 5. CLI ENTRY POINT
// ============================================================

if (require.main === module) {
  main().catch(error => {
    console.error("Fleet dispatcher failed:", error);
    process.exitCode = 1;
  });
}
