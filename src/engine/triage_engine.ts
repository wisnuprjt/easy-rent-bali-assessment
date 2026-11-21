
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// ============================================================
// 1. TELEMETRY VALIDATION
// ============================================================

const TelemetrySchema = z.object({
  device_id: z.string().min(1),
  plate: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(["available", "rented", "maintenance"]),
  current_speed_kmh: z.number().nonnegative(),
  current_location: z.object({
    zone: z.string().min(1)
  }),
  battery_voltage: z.number().nonnegative(),
  fuel_percent: z.number().min(0).max(100),
  last_ping_seconds_ago: z.number().nonnegative(),
  gateway_id: z.string().min(1)
});

export type Telemetry = z.infer<typeof TelemetrySchema>;

// ============================================================
// 2. INCIDENT DEFINITIONS
// ============================================================

export type IncidentType =
  | "CRITICAL_SECURITY_ALERT"
  | "OFFLINE_TELEMETRY_DROP"
  | "MAINTENANCE_REQUIRED";

export interface Incident {
  vehicle_id: string;
  plate_number: string;
  type: IncidentType;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  reason: string;
  recommended_action: string;
  detected_at: string;
}

// ============================================================
// 3. FLEET TRIAGE ENGINE
// ============================================================

export function triage(records: unknown[]): Incident[] {
  const incidents: Incident[] = [];
  const now = new Date().toISOString();

  for (const raw of records) {
    const t: Telemetry = TelemetrySchema.parse(raw);

    const vehicleId = t.device_id;
    const plateNumber = t.plate;
    const zone = t.current_location.zone;

    // --------------------------------------------------------
    // RULE 1: CRITICAL SECURITY ALERT
    // Available vehicle is moving OR vehicle is in restricted zone.
    // Restricted-zone detection applies regardless of rental status.
    // --------------------------------------------------------

    const isMovingWhileAvailable =
      t.status === "available" && t.current_speed_kmh > 0;

    const isInRestrictedZone =
      zone.startsWith("RESTRICTED_");

    if (isMovingWhileAvailable || isInRestrictedZone) {
      const reasons: string[] = [];

      if (isMovingWhileAvailable) {
        reasons.push(
          `Vehicle marked AVAILABLE is moving at ${t.current_speed_kmh} km/h`
        );
      }

      if (isInRestrictedZone) {
        reasons.push(
          `Vehicle is located in restricted zone ${zone}`
        );
      }

      incidents.push({
        vehicle_id: vehicleId,
        plate_number: plateNumber,
        type: "CRITICAL_SECURITY_ALERT",
        severity: "CRITICAL",
        reason: reasons.join("; "),
        recommended_action:
          "Contact field operations immediately; verify vehicle status and location.",
        detected_at: now
      });
    }

    // --------------------------------------------------------
    // RULE 2: OFFLINE TELEMETRY DROP
    // Rented vehicle has been silent for more than 15 minutes.
    // 15 minutes = 900 seconds.
    // --------------------------------------------------------

    const offlineThresholdSeconds = 15 * 60;

    if (
      t.status === "rented" &&
      t.last_ping_seconds_ago > offlineThresholdSeconds
    ) {
      const silentMinutes = Math.round(
        (t.last_ping_seconds_ago / 60) * 100
      ) / 100;

      incidents.push({
        vehicle_id: vehicleId,
        plate_number: plateNumber,
        type: "OFFLINE_TELEMETRY_DROP",
        severity: "HIGH",
        reason:
          `Rented vehicle telemetry has been silent for ${silentMinutes} minutes.`,
        recommended_action:
          "Check tracker connectivity and contact renter if required.",
        detected_at: now
      });
    }

    // --------------------------------------------------------
    // RULE 3: MAINTENANCE REQUIRED
    // Battery below 11.5V OR fuel below 15%.
    // Both conditions are recorded when applicable.
    // --------------------------------------------------------

    const lowBattery = t.battery_voltage < 11.5;
    const lowFuel = t.fuel_percent < 15;

    if (lowBattery || lowFuel) {
      const maintenanceReasons: string[] = [];
      const maintenanceActions: string[] = [];

      if (lowBattery) {
        maintenanceReasons.push(
          `Battery voltage is low (${t.battery_voltage}V)`
        );

        maintenanceActions.push(
          "inspect and recharge or replace the battery"
        );
      }

      if (lowFuel) {
        maintenanceReasons.push(
          `Fuel level is low (${t.fuel_percent}%)`
        );

        maintenanceActions.push("refuel the vehicle");
      }

      incidents.push({
        vehicle_id: vehicleId,
        plate_number: plateNumber,
        type: "MAINTENANCE_REQUIRED",
        severity: "MEDIUM",
        reason: maintenanceReasons.join("; "),
        recommended_action:
          `Schedule maintenance before the next dispatch: ${maintenanceActions.join(" and ")}.`,
        detected_at: now
      });
    }
  }

  return incidents;
}

// ============================================================
// 4. CLI EXECUTION
// ============================================================

if (require.main === module) {
  try {
    const inputPath = path.resolve(
      "data/outage_telemetry.json"
    );

    const outputPath = path.resolve(
      "output/incident_reconciliation.json"
    );

    if (!fs.existsSync(inputPath)) {
      throw new Error(
        `Telemetry input file not found: ${inputPath}`
      );
    }

    const records: unknown = JSON.parse(
      fs.readFileSync(inputPath, "utf8")
    );

    if (!Array.isArray(records)) {
      throw new Error(
        "Telemetry input must contain a JSON array."
      );
    }

    const incidents = triage(records);

    fs.mkdirSync(
      path.dirname(outputPath),
      { recursive: true }
    );

    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          source: "data/outage_telemetry.json",
          incident_count: incidents.length,
          incidents
        },
        null,
        2
      )
    );

    console.log(
      `Generated ${incidents.length} incident(s): ${outputPath}`
    );
  } catch (error) {
    console.error("Fleet triage failed:", error);
    process.exitCode = 1;
  }
}
