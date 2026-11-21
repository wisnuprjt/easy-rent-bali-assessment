
import { describe, expect, it } from "vitest";
import {
  dispatchWithRetry,
  DispatcherDependencies
} from "./dispatcher";
import { Incident } from "./triage_engine";

const mockIncident: Incident = {
  vehicle_id: "TEST-001",
  plate_number: "B 1234 TEST",
  type: "CRITICAL_SECURITY_ALERT",
  severity: "CRITICAL",
  reason: "Vehicle marked AVAILABLE is moving.",
  recommended_action: "Contact field operations immediately.",
  detected_at: new Date().toISOString()
};

describe("Fleet Dispatcher Reliability", () => {
  it("retries failed delivery and succeeds on the third attempt", async () => {
    let attempts = 0;
    const recordedDelays: number[] = [];

    const dependencies: DispatcherDependencies = {
      deliver: async () => {
        attempts++;

        if (attempts < 3) {
          throw new Error("Simulated delivery failure");
        }
      },

      sleep: async (ms: number) => {
        recordedDelays.push(ms);
      },

      random: () => 0
    };

    const result = await dispatchWithRetry(
      mockIncident,
      4,
      dependencies
    );

    expect(attempts).toBe(3);
    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.channel).toBe("SIMULATED_DISPATCH");

    // Exponential backoff: 500ms, then 1000ms.
    expect(recordedDelays).toEqual([500, 1000]);
  });

  it("stops after four failed delivery attempts", async () => {
    let attempts = 0;
    const recordedDelays: number[] = [];

    const dependencies: DispatcherDependencies = {
      deliver: async () => {
        attempts++;
        throw new Error("Simulated permanent failure");
      },

      sleep: async (ms: number) => {
        recordedDelays.push(ms);
      },

      random: () => 0
    };

    const result = await dispatchWithRetry(
      mockIncident,
      4,
      dependencies
    );

    expect(attempts).toBe(4);
    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(4);

    expect(result.last_error).toBe(
      "Simulated permanent failure"
    );

    // No delay after the final attempt.
    expect(recordedDelays).toEqual([
      500,
      1000,
      2000
    ]);
  });

  it("rejects invalid retry limits", async () => {
    const dependencies: DispatcherDependencies = {
      deliver: async () => {},
      sleep: async () => {},
      random: () => 0
    };

    await expect(
      dispatchWithRetry(mockIncident, 0, dependencies)
    ).rejects.toThrow(
      "maxAttempts must be a positive integer."
    );
  });
});
