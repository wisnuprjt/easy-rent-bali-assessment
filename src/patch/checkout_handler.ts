
import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import { createHash } from "node:crypto";
import { pool } from "../config/database";
import { z } from "zod";

const CheckoutSchema = z.object({
  vehicleId: z.number().int().positive(),
  customerId: z.number().int().positive(),
  bookingId: z.string().min(6).max(80),
  idempotencyKey: z.string().min(8).max(120)
});

type CheckoutInput = z.infer<typeof CheckoutSchema>;

type VehicleRow = RowDataPacket & {
  id: number;
  status: string;
};

type IdempotencyRow = RowDataPacket & {
  id: number;
  request_hash: string;
  response_json: unknown;
  status: string;
};

function stableHash(input: CheckoutInput): string {
  const payload = JSON.stringify({
    vehicleId: input.vehicleId,
    customerId: input.customerId,
    bookingId: input.bookingId
  });

  return createHash("sha256").update(payload).digest("hex");
}

function parseStoredResponse(value: unknown): any {
  if (typeof value === "string") {
    return JSON.parse(value);
  }

  return value;
}

export async function checkoutHandler(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = CheckoutSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_REQUEST",
      details: parsed.error.flatten()
    });
    return;
  }

  const input = parsed.data;
  const requestHash = stableHash(input);
  const conn = await pool.getConnection();

  let connectionReleased = false;

  try {
    await conn.beginTransaction();

    try {
      await conn.execute(
        `INSERT INTO idempotency_records
          (idempotency_key, request_hash, status)
         VALUES (?, ?, 'PROCESSING')`,
        [input.idempotencyKey, requestHash]
      );
    } catch (error: any) {
      if (error?.code !== "ER_DUP_ENTRY") {
        throw error;
      }

      await conn.rollback();

      // Release exactly once before querying through the pool.
      conn.release();
      connectionReleased = true;

      const [rows] = await pool.execute<IdempotencyRow[]>(
        `SELECT id, request_hash, response_json, status
         FROM idempotency_records
         WHERE idempotency_key = ?
         LIMIT 1`,
        [input.idempotencyKey]
      );

      const existing = rows[0];

      if (!existing) {
        res.status(409).json({
          error: "IDEMPOTENCY_RECORD_NOT_FOUND"
        });
        return;
      }

      if (existing.request_hash !== requestHash) {
        res.status(409).json({
          error: "IDEMPOTENCY_KEY_REUSED",
          message: "Key was used for a different request."
        });
        return;
      }

      if (
        existing.status === "COMPLETED" &&
        existing.response_json
      ) {
        res.status(200).json(
          parseStoredResponse(existing.response_json)
        );
        return;
      }

      if (
        existing.status === "FAILED" &&
        existing.response_json
      ) {
        res.status(409).json(
          parseStoredResponse(existing.response_json)
        );
        return;
      }

      res.status(409).json({
        error: "IDEMPOTENCY_IN_PROGRESS",
        message: "A request with this key is being processed."
      });
      return;
    }

    // Lock vehicle row to prevent concurrent double booking.
    const [vehicleRows] = await conn.execute<VehicleRow[]>(
      "SELECT id, status FROM vehicles WHERE id = ? FOR UPDATE",
      [input.vehicleId]
    );

    const vehicle = vehicleRows[0];

    if (!vehicle || vehicle.status !== "AVAILABLE") {
      const responseBody = {
        error: "VEHICLE_NOT_AVAILABLE",
        message: "Vehicle is no longer available."
      };

      await conn.execute(
        `UPDATE idempotency_records
         SET status = 'FAILED', response_json = ?
         WHERE idempotency_key = ?`,
        [
          JSON.stringify(responseBody),
          input.idempotencyKey
        ]
      );

      await conn.commit();

      res.status(409).json(responseBody);
      return;
    }

    // Create reservation while holding the vehicle lock.
    await conn.execute(
      `INSERT INTO vehicle_reservations
        (booking_id, vehicle_id, customer_id, status)
       VALUES (?, ?, ?, 'CONFIRMED')`,
      [
        input.bookingId,
        input.vehicleId,
        input.customerId
      ]
    );

    await conn.execute(
      "UPDATE vehicles SET status = 'RENTED' WHERE id = ?",
      [input.vehicleId]
    );

    const responseBody = {
      success: true,
      bookingId: input.bookingId,
      vehicleId: input.vehicleId,
      status: "CONFIRMED"
    };

    await conn.execute(
      `UPDATE idempotency_records
       SET status = 'COMPLETED', response_json = ?
       WHERE idempotency_key = ?`,
      [
        JSON.stringify(responseBody),
        input.idempotencyKey
      ]
    );

    await conn.commit();

    res.status(201).json(responseBody);

  } catch (error: any) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }

    if (error?.code === "ER_DUP_ENTRY") {
      res.status(409).json({
        error: "BOOKING_ALREADY_EXISTS"
      });
      return;
    }

    console.error("Checkout failed:", error);

    res.status(500).json({
      error: "INTERNAL_ERROR"
    });

  } finally {
    if (!connectionReleased) {
      conn.release();
    }
  }
}
