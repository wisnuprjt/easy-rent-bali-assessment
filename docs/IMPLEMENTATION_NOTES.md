# Implementation Notes

- Database adapter: `mysql2/promise`; target is Laragon MySQL with InnoDB.
- Row-level locking requires InnoDB and a transaction.
- The checkout endpoint expects `vehicleId`, `customerId`, `bookingId`, and `idempotencyKey`.
- The integration concurrency script uses the local test vehicle ID 9001.
- Fleet dispatch is intentionally simulated; no external notification credentials are included.
- Verify the exact telemetry JSON schema against the assessment-provided source file before submission.
