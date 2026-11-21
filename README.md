# Easy Rent Bali — Infrastructure, Concurrency & Fleet Reliability

A technical assessment project for **Option C: Infrastructure, Concurrency & Fleet Reliability**.

This project addresses three operational challenges at Easy Rent Bali:

1. Branch network segmentation and dual-WAN failover design.
2. Concurrent vehicle checkout, database deadlocks, and payment idempotency.
3. Fleet telemetry monitoring, incident detection, and automated dispatch simulation.

## Features

- **Network Architecture:** Proposed topology connecting Kuta Hub, HQ Renon, and Cloud Management.
- **VLAN Segmentation:** Five isolated network segments for Management, POS & Kiosks, Staff, Fleet IoT & CCTV, and Guest Wi-Fi.
- **Dual-WAN Failover:** Primary and backup WAN design with health checks and a sub-3-second failover target.
- **Thread-Safe Checkout:** MySQL transactions and row-level locking to prevent duplicate vehicle reservations.
- **Idempotency Protection:** Request fingerprinting and idempotency keys to prevent duplicate checkout operations.
- **Conflict Handling:** HTTP 409 responses for unavailable vehicles and conflicting requests.
- **Fleet Telemetry Triage:** Detection of security alerts, offline telemetry, and maintenance requirements.
- **Incident Dispatcher:** Simulated incident delivery with exponential backoff and random jitter.
- **Automated Testing:** Concurrency, idempotency, fleet triage, and dispatcher retry tests.

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Language | TypeScript |
| Backend | Node.js, Express.js |
| Database | MySQL 8 (Laragon) |
| Database Driver | mysql2 |
| Validation | Zod |
| Request Fingerprinting | SHA-256 |
| Concurrency Control | MySQL InnoDB Transactions & Row-Level Locking |
| Testing | Vitest |
| Development | npm, TypeScript |

## Project Structure

```text
easy-rent-bali-assessment/
├── data/
│   └── outage_telemetry.json
├── database/
│   └── schema.sql
├── docs/
│   ├── NETWORK_ARCHITECTURE.md
│   └── RCA.md
├── output/
│   ├── incident_reconciliation.json
│   └── dispatch_results.json
├── src/
│   ├── patch/
│   │   ├── checkout_handler.ts
│   │   └── test_concurrency.ts
│   └── engine/
│       ├── triage_engine.ts
│       ├── triage_engine.test.ts
│       ├── dispatcher.ts
│       └── dispatcher.test.ts
├── ai_session_logs/
│   ├── README.md
│   ├── STEERING_AUDIT.md
│   └── raw_logs/
│       ├── dispatcher-retry.md
│       └── fleet-triage.md
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start

### Requirements

- Node.js 22
- npm
- Laragon with MySQL 8
- Git (optional)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a local `.env` file:

```bash
copy .env.example .env
```

Configure the database connection in `.env`:

```env
PORT=4000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=easy_rent_bali

DB_CONNECTION_LIMIT=10
```

Update the values according to your local MySQL configuration.

### 3. Database Setup

1. Open Laragon and start MySQL.
2. Open HeidiSQL or phpMyAdmin.
3. Import `database/schema.sql`.
4. Confirm that the `easy_rent_bali` database and required tables have been created.
5. Verify the database credentials in `.env`.

### 4. Start the Application

```bash
npm run dev
```

Health check:

```http
GET http://localhost:4000/health
```

## Available Commands

| Command | Description |
|---|---|
| `npm install` | Install project dependencies |
| `npm run dev` | Start the development server |
| `npm run build` | Compile TypeScript |
| `npm start` | Start the compiled application |
| `npm run typecheck` | Check TypeScript types |
| `npm test` | Run automated unit tests |
| `npm run test:concurrency` | Run checkout concurrency tests |
| `npm run fleet:triage` | Analyze fleet telemetry and generate incidents |
| `npm run fleet:dispatch` | Simulate incident dispatch with retry handling |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Check application and database connectivity |
| POST | `/api/checkout` | Process a vehicle checkout request |

### Checkout Request Example

```http
POST /api/checkout
Content-Type: application/json
```

```json
{
  "vehicleId": 9001,
  "customerId": 7001,
  "bookingId": "booking-2026-0001",
  "idempotencyKey": "checkout-request-0001"
}
```

## Checkout Concurrency & Idempotency

The checkout handler uses MySQL InnoDB transactions and `SELECT ... FOR UPDATE` to ensure that only one customer can reserve an available vehicle at a time.

The implementation includes:

- Unique idempotency keys.
- SHA-256 request payload fingerprinting.
- Stored responses for successful request replays.
- HTTP 409 conflict responses for unavailable vehicles.
- HTTP 409 responses when an idempotency key is reused with a different payload.

### Concurrency Test

The test sends five simultaneous checkout requests for the same vehicle.

| Expected Result | Response |
|---|---|
| Successful checkout | 1 × HTTP 201 |
| Conflict response | 4 × HTTP 409 |

Additional tests verify successful idempotency replay and rejection of reused keys with different request payloads.

**Important:** Run concurrency tests only against the local disposable assessment database. The test uses dedicated assessment vehicle records and resets test data.

## Fleet Triage & Incident Dispatch

The triage engine reads the supplied telemetry dataset:

`data/outage_telemetry.json`

It identifies three incident categories:

| Incident Type | Detection Rule |
|---|---|
| `CRITICAL_SECURITY_ALERT` | An available vehicle is moving or a vehicle is located in a restricted zone |
| `OFFLINE_TELEMETRY_DROP` | A rented vehicle has not sent telemetry for more than 15 minutes |
| `MAINTENANCE_REQUIRED` | Battery voltage is below 11.5V or fuel level is below 15% |

The generated incident report is written to:

`output/incident_reconciliation.json`

### Incident Dispatcher

The dispatcher processes generated incidents using:

- Exponential backoff.
- Random jitter.
- Configurable maximum retry attempts.
- Delivery result tracking.

Dispatch results are written to:

`output/dispatch_results.json`

The current implementation uses simulated delivery. No external notification provider is connected.

## Network Architecture

The proposed network design is documented in:

`docs/NETWORK_ARCHITECTURE.md`

The architecture covers:

- Kuta Hub, HQ Renon, and Cloud Management connectivity.
- 802.1Q VLAN segmentation.
- Inter-VLAN access control policies.
- Dual-WAN primary and backup connectivity.
- WAN failover health checks.
- Guest Wi-Fi traffic shaping during WAN2 backup operation.

### VLAN Overview

| VLAN | Network Segment | Subnet |
|---|---|---|
| VLAN 10 | Management | `10.10.10.0/24` |
| VLAN 20 | POS & Kiosks | `10.10.20.0/24` |
| VLAN 30 | Staff | `10.10.30.0/24` |
| VLAN 40 | Fleet IoT & CCTV | `10.10.40.0/24` |
| VLAN 50 | Guest Wi-Fi | `172.16.50.0/22` |

The proposed sub-3-second failover and WAN2 traffic-shaping targets require validation on actual network equipment.

## Testing & Verification

The implementation was verified using local automated tests and database execution.

| Component | Verification Result |
|---|---|
| TypeScript typecheck | PASS |
| Production build | PASS |
| Unit tests | 11/11 PASS |
| Checkout concurrency | 1 × HTTP 201, 4 × HTTP 409 |
| Idempotency replay | PASS |
| Idempotency key reuse | HTTP 409 |
| Fleet triage | 6 incidents generated |
| Dispatcher retry tests | 3/3 PASS |
| Dispatcher simulation | 6 processed, 0 failures |

### Run Tests

```bash
npm run typecheck
npm test
npm run build
```

Run checkout concurrency tests:

```bash
npm run test:concurrency
```

Run fleet processing:

```bash
npm run fleet:triage
npm run fleet:dispatch
```

## Limitations & Future Improvements

| Area | Current Limitation | Potential Improvement |
|---|---|---|
| Network Failover | Proposed architecture has not been tested on physical network equipment. | Validate with actual dual-WAN routers and switches. |
| Incident Dispatch | Delivery is simulated without an external notification provider. | Integrate an authorized notification service. |
| Checkout Concurrency | Tested against a local MySQL assessment database. | Perform additional controlled staging and load testing. |
| Fleet Monitoring | Uses the supplied JSON telemetry dataset. | Integrate a live telemetry ingestion pipeline. |
| Payment Integration | Payment provider integration is not implemented. | Implement payment authorization, confirmed vehicle reservation, and capture with compensation handling. |

## AI-Assisted Development

AI tools were used as development assistants for implementation suggestions, debugging, code reviews, and test improvements.

The candidate reviewed AI-generated suggestions, identified implementation issues, directed corrections, and validated the resulting changes through local execution and automated testing.

The development iterations, steering decisions, and verification results are documented in:

- `ai_session_logs/STEERING_AUDIT.md`
- `ai_session_logs/raw_logs/`

Only genuine AI conversation excerpts are included in the raw logs.

---

**Assessment:** Option C — Infrastructure, Concurrency & Fleet Reliability  
**Project:** Easy Rent Bali Technical Assessment