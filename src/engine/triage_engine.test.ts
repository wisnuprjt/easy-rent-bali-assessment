
import { describe, expect, it } from "vitest";
import { triage } from "./triage_engine";

const baseVehicle = {
  device_id: "iot_test_01",
  plate: "DK 1234 TEST",
  model: "Toyota Avanza",
  status: "available",
  current_speed_kmh: 0,
  current_location: {
    zone: "KUTA_HUB"
  },
  battery_voltage: 12.5,
  fuel_percent: 50,
  last_ping_seconds_ago: 60,
  gateway_id: "gw_kuta_01"
};

describe("Fleet Triage Engine", () => {
  it("flags available vehicles that are moving", () => {
    const incidents = triage([{
      ...baseVehicle,
      current_speed_kmh: 10
    }]);

    expect(
      incidents.some(
        i => i.type === "CRITICAL_SECURITY_ALERT"
      )
    ).toBe(true);
  });

  it("flags vehicles inside restricted zones regardless of rental status", () => {
    const incidents = triage([{
      ...baseVehicle,
      status: "rented",
      current_location: {
        zone: "RESTRICTED_OFFROAD_BATUKARU"
      }
    }]);

    const securityIncident = incidents.find(
      i => i.type === "CRITICAL_SECURITY_ALERT"
    );

    expect(securityIncident).toBeDefined();
    expect(securityIncident?.reason).toContain(
      "RESTRICTED_OFFROAD_BATUKARU"
    );
  });

  it("flags rented vehicles silent for more than 15 minutes", () => {
    const incidents = triage([{
      ...baseVehicle,
      status: "rented",
      last_ping_seconds_ago: 901
    }]);

    expect(
      incidents.some(
        i => i.type === "OFFLINE_TELEMETRY_DROP"
      )
    ).toBe(true);
  });

  it("does not flag rented vehicles silent for exactly 15 minutes", () => {
    const incidents = triage([{
      ...baseVehicle,
      status: "rented",
      last_ping_seconds_ago: 900
    }]);

    expect(
      incidents.some(
        i => i.type === "OFFLINE_TELEMETRY_DROP"
      )
    ).toBe(false);
  });

  it("flags battery voltage below 11.5V", () => {
    const incidents = triage([{
      ...baseVehicle,
      battery_voltage: 11.4
    }]);

    const maintenance = incidents.find(
      i => i.type === "MAINTENANCE_REQUIRED"
    );

    expect(maintenance).toBeDefined();
    expect(maintenance?.reason).toContain(
      "Battery voltage is low"
    );
  });

  it("flags fuel below 15%", () => {
    const incidents = triage([{
      ...baseVehicle,
      fuel_percent: 14
    }]);

    const maintenance = incidents.find(
      i => i.type === "MAINTENANCE_REQUIRED"
    );

    expect(maintenance).toBeDefined();
    expect(maintenance?.reason).toContain(
      "Fuel level is low"
    );
  });

  it("records both low battery and low fuel in one maintenance incident", () => {
    const incidents = triage([{
      ...baseVehicle,
      battery_voltage: 10.8,
      fuel_percent: 10
    }]);

    const maintenance = incidents.find(
      i => i.type === "MAINTENANCE_REQUIRED"
    );

    expect(maintenance).toBeDefined();
    expect(maintenance?.reason).toContain(
      "Battery voltage is low"
    );
    expect(maintenance?.reason).toContain(
      "Fuel level is low"
    );
    expect(maintenance?.recommended_action).toContain(
      "battery"
    );
    expect(maintenance?.recommended_action).toContain(
      "refuel"
    );
  });

  it("does not flag values exactly at the maintenance thresholds", () => {
    const incidents = triage([{
      ...baseVehicle,
      battery_voltage: 11.5,
      fuel_percent: 15
    }]);

    expect(
      incidents.some(
        i => i.type === "MAINTENANCE_REQUIRED"
      )
    ).toBe(false);
  });
});
