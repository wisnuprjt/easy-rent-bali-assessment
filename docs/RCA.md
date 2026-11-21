# Root Cause Analysis — Concurrent Vehicle Checkout

## 1. Incident Overview

During the Kuta Sunset Outage, the self-service kiosks experienced request timeouts due to unstable network connectivity.

Automatic client retries caused multiple checkout requests to be submitted concurrently for the same vehicle, including `car_avanza_04`.

The concurrent transactions resulted in database deadlocks and inconsistent checkout outcomes. In some cases, payment was captured even though the vehicle reservation had not been successfully confirmed.

The reported database error was:

```text
[2026-10-29T18:32:14.218+08:00] ERROR [CheckoutWorker]
TransactionRollbackError: deadlock detected

Process 9182 waits for ExclusiveLock on relation
'vehicle_reservations'; blocked by process 9188.

Payload:
{
  "booking_id": "erb_kuta_9941",
  "vehicle_id": "car_avanza_04",
  "customer_id": "cust_foreign_881"
}
```

## 2. Root Cause Analysis

### 2.1 Concurrent Checkout Requests

The checkout workflow was vulnerable to concurrent requests because vehicle availability checks and reservation writes were not guaranteed to execute as one atomic operation.

A typical read-then-write sequence could allow multiple requests to observe the same vehicle as `AVAILABLE` before either request updates its status.

This creates a race condition that can lead to duplicate reservation attempts.

### 2.2 Transactional Deadlocks

During the network outage, kiosk timeouts triggered automatic retries while earlier checkout transactions could still be executing.

As a result:

1. Multiple checkout requests attempted to reserve the same vehicle.
2. Their database transactions competed for locks on reservation-related records.
3. Concurrent lock acquisition and waiting created a deadlock condition.
4. MySQL detected the deadlock and rolled back an affected transaction.
5. Client retries submitted additional requests, increasing database contention.

The reported error confirms a lock conflict involving the `vehicle_reservations` relation.

Repeated retries without proper coordination and idempotency protection can amplify transaction contention instead of resolving the original request safely.

### 2.3 Duplicate Side Effects

Without strict idempotency enforcement, a retry may be treated as a new checkout operation.

This can result in:

- Duplicate reservation attempts.
- Repeated payment processing requests.
- Inconsistent vehicle and payment states.
- Additional database contention during peak operations.

A network timeout does not necessarily mean that the original server-side request failed. The original transaction may still be processing or may already have completed.

## 3. Payment Captured Without Confirmed Vehicle Holds

The incident can occur when the payment workflow captures a customer's payment before the vehicle reservation has been successfully committed.

A possible failure sequence is:

1. The kiosk sends a checkout request.
2. The payment service captures the customer's payment.
3. The checkout transaction attempts to reserve the vehicle.
4. Concurrent transactions cause a database deadlock.
5. The database transaction rolls back, leaving no confirmed vehicle reservation.
6. The customer has already been charged because an external payment capture is not automatically reversed by a database rollback.

MySQL transactions cannot automatically roll back operations performed by an external payment provider.

This creates a consistency problem between payment status and vehicle reservation status.

### Recommended Corrective Payment Workflow

1. Authorize the payment without capturing the funds.
2. Check vehicle availability and create the reservation inside a MySQL transaction.
3. Commit the transaction after the vehicle hold is confirmed.
4. Capture the authorized payment only after successful reservation confirmation.
5. If payment capture fails, initiate a reservation release or compensation workflow.
6. Use payment-provider idempotency keys to prevent duplicate captures during retries.

This approach separates vehicle reservation consistency from external payment processing and reduces the risk of charging customers without a confirmed vehicle.

**Implementation scope:** The current assessment patch protects the database checkout transaction and idempotency boundary. External payment authorization, capture, and compensation are documented as the recommended production workflow and are not integrated in this prototype.

## 4. Corrective Design

The checkout implementation uses MySQL InnoDB transactions, row-level locking, and strict idempotency enforcement.

The corrective approach consists of:

1. Validate the incoming checkout request.
2. Generate a stable SHA-256 fingerprint from the request payload.
3. Insert a unique idempotency key to prevent duplicate processing.
4. Start a MySQL transaction.
5. Lock the target vehicle record using `SELECT ... FOR UPDATE`.
6. Check vehicle availability while holding the lock.
7. Insert the reservation and update vehicle status within the same transaction.
8. Store the successful response against the idempotency key.
9. Commit the transaction.
10. Return HTTP 409 when the vehicle is unavailable or a conflicting request is detected.

### Idempotency Handling

The implementation supports the following scenarios:

| Scenario | Expected Behavior |
|---|---|
| New valid checkout request | Process checkout |
| Same idempotency key and same payload | Replay stored successful response |
| Same idempotency key with different payload | Reject with HTTP 409 |
| Vehicle already reserved | Reject with HTTP 409 |
| Request already being processed | Reject conflicting duplicate request |

This ensures that repeated client requests do not create multiple successful reservations for the same operation.

## 5. Concurrency Test and Expected Invariant

The concurrency integration test sends five simultaneous checkout requests for the same available vehicle using distinct booking IDs and idempotency keys.

Expected result:

| Result | Expected Response |
|---|---|
| Successful checkout | 1 × HTTP 201 |
| Conflicting checkout | 4 × HTTP 409 |

The test also verifies:

- Successful idempotency replay.
- Rejection of idempotency key reuse with a different payload.
- Prevention of duplicate vehicle reservations.

The integration test uses dedicated local assessment vehicle records, including vehicle ID `9001`.

**Actual verification:** The implemented concurrency test returned exactly one HTTP 201 response and four HTTP 409 responses. Idempotency replay and conflicting payload rejection also passed.

## 6. Operational Recommendations

To reduce the likelihood and impact of similar incidents in production:

- Use strict idempotency keys for checkout and payment operations.
- Keep database transactions short.
- Apply consistent lock acquisition patterns across checkout operations.
- Avoid holding database locks while waiting for external payment services.
- Implement bounded retries with exponential backoff and jitter.
- Distinguish retryable database failures from permanent business conflicts.
- Monitor database deadlocks, transaction duration, HTTP 409 rates, and idempotency replay counts.
- Reconcile payment records against confirmed vehicle reservations.
- Implement compensation or refund handling for payment inconsistencies.

## 7. Implementation Limitations

The current assessment implementation demonstrates database-level concurrency protection and idempotency handling.

The following production capabilities are not integrated:

- External payment authorization and capture.
- Automated payment refunds or compensation.
- External notification provider integration.
- Production distributed locking infrastructure.

These capabilities require integration with the relevant payment provider and production infrastructure.

## 8. Conclusion

The incident was caused by the interaction of unstable network connectivity, automatic kiosk retries, concurrent checkout transactions, and insufficient idempotency protection.

The corrective implementation addresses the database race condition using MySQL InnoDB transactions, row-level locking, request fingerprinting, and HTTP 409 conflict handling.

The payment workflow recommendations additionally address the risk of capturing customer payments without confirmed vehicle reservations.

Together, these measures improve checkout consistency and provide a safer foundation for reliable fleet rental operations.