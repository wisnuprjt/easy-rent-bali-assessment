
import "dotenv/config";
import assert from "node:assert/strict";
import { RowDataPacket } from "mysql2";
import { Request, Response } from "express";

import { pool } from "../config/database";
import { checkoutHandler } from "./checkout_handler";

type Outcome = {
  statusCode: number;
  body: any;
};

/**
 * Simulates an Express request and response.
 */
function invokeCheckout(body: object): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const req = { body } as Request;

    let statusCode = 200;

    const mockResponse: any = {
      status(code: number) {
        statusCode = code;
        return mockResponse;
      },

      json(payload: any) {
        resolve({
          statusCode,
          body: payload
        });

        return mockResponse;
      }
    };

    const res = mockResponse as Response;

    checkoutHandler(req, res).catch(reject);
  });
}

/**
 * Prepares a dedicated test vehicle.
 * Do not use production vehicle IDs.
 */
async function prepareVehicle(vehicleId: number): Promise<void> {
  await pool.execute(
    `INSERT INTO vehicles (id, plate_number, status)
     VALUES (?, ?, 'AVAILABLE')
     ON DUPLICATE KEY UPDATE
       plate_number = VALUES(plate_number),
       status = 'AVAILABLE'`,
    [vehicleId, `TEST-${vehicleId}`]
  );

  await pool.execute(
    "DELETE FROM vehicle_reservations WHERE vehicle_id = ?",
    [vehicleId]
  );
}

/**
 * Counts reservations associated with a booking ID.
 */
async function countReservations(bookingId: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
     FROM vehicle_reservations
     WHERE booking_id = ?`,
    [bookingId]
  );

  return Number(rows[0].total);
}

/**
 * TEST 1:
 * Five simultaneous checkout requests for one vehicle.
 *
 * Expected:
 * 1 request returns HTTP 201.
 * 4 requests return HTTP 409.
 */
async function testConcurrency(runId: string): Promise<void> {
  console.log("\n========================================");
  console.log("TEST 1: CONCURRENT CHECKOUT");
  console.log("========================================");

  const vehicleId = 9001;
  const customerBase = Number(process.env.TEST_CUSTOMER_ID ?? 7000);

  await prepareVehicle(vehicleId);

  const requests = Array.from({ length: 5 }, (_, index) => ({
    vehicleId,
    customerId: customerBase + index,
    bookingId: `assessment-booking-${runId}-${index}`,
    idempotencyKey: `assessment-concurrency-${runId}-${index}`
  }));

  const results = await Promise.all(
    requests.map(request => invokeCheckout(request))
  );

  const successes = results.filter(
    result => result.statusCode === 201
  ).length;

  const conflicts = results.filter(
    result => result.statusCode === 409
  ).length;

  console.log(
    JSON.stringify(
      {
        successes,
        conflicts,
        results
      },
      null,
      2
    )
  );

  assert.equal(
    successes,
    1,
    "Expected exactly one successful checkout"
  );

  assert.equal(
    conflicts,
    4,
    "Expected exactly four conflicting requests"
  );

  console.log("PASS: Exactly 1 success and 4 conflicts.");
}

/**
 * TEST 2:
 * Repeats the same request using the same idempotency key.
 *
 * Expected:
 * First request returns HTTP 201.
 * Replay returns HTTP 200.
 * Only one reservation exists.
 */
async function testIdempotencyReplay(runId: string): Promise<void> {
  console.log("\n========================================");
  console.log("TEST 2: IDEMPOTENCY REPLAY");
  console.log("========================================");

  const vehicleId = 9002;
  const bookingId = `assessment-idem-${runId}`;
  const idempotencyKey = `assessment-idem-key-${runId}`;

  await prepareVehicle(vehicleId);

  const request = {
    vehicleId,
    customerId: 8001,
    bookingId,
    idempotencyKey
  };

  const firstRequest = await invokeCheckout(request);
  const replayRequest = await invokeCheckout(request);

  console.log(
    JSON.stringify(
      {
        firstRequest,
        replayRequest
      },
      null,
      2
    )
  );

  assert.equal(firstRequest.statusCode, 201);
  assert.equal(replayRequest.statusCode, 200);

  assert.deepEqual(
    replayRequest.body,
    firstRequest.body,
    "Replay should return the original response"
  );

  const reservationCount = await countReservations(bookingId);

  assert.equal(
    reservationCount,
    1,
    "Replay must not create a duplicate reservation"
  );

  console.log(
    "PASS: Same key and payload returned the original response."
  );
}

/**
 * TEST 3:
 * Reuses an idempotency key with a different request payload.
 *
 * Expected:
 * First request returns HTTP 201.
 * Second request returns HTTP 409.
 * No additional reservation is created.
 */
async function testIdempotencyKeyReuse(runId: string): Promise<void> {
  console.log("\n========================================");
  console.log("TEST 3: IDEMPOTENCY KEY REUSE");
  console.log("========================================");

  const vehicleId = 9003;
  const idempotencyKey = `assessment-reuse-key-${runId}`;

  await prepareVehicle(vehicleId);

  const originalRequest = {
    vehicleId,
    customerId: 8002,
    bookingId: `assessment-original-${runId}`,
    idempotencyKey
  };

  const modifiedRequest = {
    ...originalRequest,
    bookingId: `assessment-modified-${runId}`
  };

  const firstRequest = await invokeCheckout(originalRequest);
  const reusedKeyRequest = await invokeCheckout(modifiedRequest);

  console.log(
    JSON.stringify(
      {
        firstRequest,
        reusedKeyRequest
      },
      null,
      2
    )
  );

  assert.equal(firstRequest.statusCode, 201);
  assert.equal(reusedKeyRequest.statusCode, 409);

  assert.equal(
    reusedKeyRequest.body.error,
    "IDEMPOTENCY_KEY_REUSED"
  );

  const originalReservationCount = await countReservations(
    originalRequest.bookingId
  );

  const modifiedReservationCount = await countReservations(
    modifiedRequest.bookingId
  );

  assert.equal(originalReservationCount, 1);
  assert.equal(modifiedReservationCount, 0);

  console.log(
    "PASS: Reusing the same key with a different payload was rejected."
  );
}

/**
 * Runs all assessment tests.
 */
async function main(): Promise<void> {
  const runId = Date.now().toString();

  try {
    await testConcurrency(runId);
    await testIdempotencyReplay(runId);
    await testIdempotencyKeyReuse(runId);

    console.log("\n========================================");
    console.log("ALL TESTS PASSED");
    console.log("========================================");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("\nTEST FAILED:");
  console.error(error);

  process.exitCode = 1;
});
