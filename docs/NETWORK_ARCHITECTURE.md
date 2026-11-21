# Network Architecture — Easy Rent Bali (Option C)

## 1. Overview

This document proposes a resilient branch network architecture for Easy Rent Bali's Kuta Hub, connecting branch operations to HQ Renon and Cloud Management.

The design addresses the network outage scenario by introducing:

- 802.1Q VLAN segmentation.
- DHCP scopes for each network segment.
- Inter-VLAN access control with a deny-by-default policy.
- Quality of Service (QoS) prioritization for critical business traffic.
- Dual-WAN failover with active health checks.
- Guest Wi-Fi bandwidth restrictions during backup WAN operation.

The architecture is a proposed design and requires validation on the actual network equipment before production deployment.

## 2. Network Topology

```text
                         INTERNET
                            |
                +-----------+-----------+
                |                       |
           ISP-1 PRIMARY           ISP-2 BACKUP
                |                       |
                +-----------+-----------+
                            |
                  +-------------------+
                  | Dual-WAN Router   |
                  | Failover + QoS    |
                  | Firewall + NAT    |
                  +-------------------+
                            |
                       802.1Q Trunk
                            |
                  +-------------------+
                  | Managed L2/L3     |
                  | Switch            |
                  +-------------------+
                    |   |   |   |   |
                    |   |   |   |   |
                  VLAN10 VLAN20 VLAN30 VLAN40 VLAN50
                  Mgmt   POS    Staff  IoT/CCTV Guest
                    |
              +----------------+
              | Kuta Hub       |
              | Branch Network|
              +----------------+
                    |
              IPsec Site-to-Site VPN
                    |
              +----------------+
              | HQ Renon       |
              | Firewall/Core  |
              +----------------+
                    |
              +----------------+
              | Cloud          |
              | Management     |
              +----------------+
```

### Connectivity Design

- ISP-1 is the primary internet connection.
- ISP-2 is the secondary cellular or backup connection.
- The dual-WAN router performs health checks, routing decisions, NAT, firewall enforcement, and traffic shaping.
- The managed switch carries VLAN traffic through 802.1Q tagged trunks.
- Kuta Hub connects to HQ Renon through an encrypted site-to-site IPsec VPN.
- Cloud Management is accessed through the HQ security gateway or an independently managed VPN tunnel.
- Database and administrative services must not be exposed directly to the public internet.

## 3. VLAN and IP Addressing Matrix

The following VLAN assignments follow the assessment requirements.

| VLAN | Network Name | Subnet | Default Gateway | DHCP Scope |
|---|---|---|---|---|
| 10 | Management | 10.10.10.0/24 | 10.10.10.1 | 10.10.10.50–10.10.10.200 |
| 20 | POS & Kiosks | 10.10.20.0/24 | 10.10.20.1 | 10.10.20.50–10.10.20.200 |
| 30 | Staff | 10.10.30.0/24 | 10.10.30.1 | 10.10.30.50–10.10.30.200 |
| 40 | Fleet IoT & CCTV | 10.10.40.0/24 | 10.10.40.1 | 10.10.40.50–10.10.40.200 |
| 50 | Guest Wi-Fi | 172.16.50.0/22 | 172.16.50.1 | 172.16.50.50–172.16.53.250 |

### DHCP Configuration Notes

- Reserve addresses below the DHCP ranges for gateways, network infrastructure, and critical services.
- Use DHCP reservations for devices that require predictable addresses, such as telemetry gateways, NVRs, and POS terminals.
- Configure the correct default gateway and DNS servers for each VLAN.
- Use DHCP lease monitoring to identify address exhaustion and abnormal client behavior.
- Management infrastructure should use static addressing or controlled DHCP reservations.

## 4. VLAN Security and QoS Policy

| VLAN | Purpose | Security Policy | QoS Priority |
|---|---|---|---|
| 10 | Switches, routers, APs, and gateways | IT administration only; restricted management access | High |
| 20 | POS terminals and self-service kiosks | Strict isolation; access only to approved POS, payment, and business services | Highest; DSCP EF |
| 30 | Office workstations and printers | Access to approved internal business applications | Medium |
| 40 | Fleet telemetry gateways and yard CCTV | No public internet ingress; allow only required telemetry and NVR communication | High for telemetry |
| 50 | Guest Wi-Fi | Client isolation; deny access to internal subnets | Low; rate-limited |

### QoS Strategy

1. VLAN 20 receives the highest business traffic priority. Apply DSCP EF marking to latency-sensitive POS and kiosk traffic where supported by the application and network equipment.
2. Fleet telemetry traffic from VLAN 40 receives high priority to preserve gateway heartbeat and vehicle tracking updates.
3. VLAN 10 management traffic is restricted to authorized IT endpoints.
4. VLAN 30 staff traffic receives normal business priority.
5. VLAN 50 guest traffic receives the lowest priority and is rate-limited to a maximum of 2 Mbps per client.

QoS markings should be trusted only from authorized devices. Untrusted client traffic must be remarked or policed at the network edge.

## 5. Inter-VLAN Routing and Access Control

Apply a deny-by-default policy between VLANs. Only explicitly approved communication flows should be allowed.

| Source VLAN | Destination | Policy |
|---|---|---|
| VLAN 10 Management | Network infrastructure | Allow administration from authorized IT endpoints |
| VLAN 20 POS & Kiosks | Approved POS/payment services | Allow required application traffic |
| VLAN 20 POS & Kiosks | Other internal VLANs | Deny by default |
| VLAN 30 Staff | Approved internal business services and printers | Allow required application and printing traffic |
| VLAN 40 Fleet IoT & CCTV | Approved telemetry API, DNS, NTP, and NVR | Allow only required destinations and ports |
| VLAN 50 Guest Wi-Fi | Public internet | Allow with client isolation and bandwidth limits |
| VLAN 50 Guest Wi-Fi | All internal private subnets | Deny |
| Any unauthorized source | Management interfaces | Deny |

### Additional Security Controls

- Block unsolicited inbound connections from the public internet.
- Do not permit guest clients to communicate with each other.
- Restrict switch, router, firewall, and NVR administration to authorized management endpoints.
- Disable unused switch ports or place them in an isolated parking VLAN.
- Log denied inter-VLAN traffic and administrative access attempts.
- Permit only required DNS and NTP services for network clients.

## 6. Dual-WAN Failover Design

### Primary and Backup WAN

| Connection | Role | Behavior |
|---|---|---|
| ISP-1 | Primary WAN | Preferred default route during normal operation |
| ISP-2 | Backup WAN | Activated when ISP-1 fails health checks |

### Health Check Configuration

Use active health checks against at least two independent targets.

Example tracking targets:

- ISP-1 next-hop gateway.
- A stable public endpoint such as 1.1.1.1.
- An independent endpoint such as 8.8.8.8.

Example monitoring policy:

| Parameter | Proposed Value |
|---|---|
| Probe interval | 500 ms |
| Consecutive failed probes | 3 |
| Failure detection target | Approximately 1.5 seconds |
| Failover objective | Below 3 seconds |
| Recovery | Require stable successful probes before switching back |
| Flapping protection | Recovery hold-down timer |

### Failover Logic

1. ISP-1 is selected as the preferred route.
2. The router continuously probes the configured health-check targets.
3. If three consecutive probes fail, ISP-1 is marked unhealthy.
4. The router activates ISP-2 as the backup route.
5. Routing and NAT states are updated according to router capabilities.
6. VPN and cloud application connectivity are re-established or recovered.
7. ISP-1 is restored as primary only after the recovery hold-down condition is satisfied.

The sub-3-second objective is a design target, not a measured result. Actual convergence depends on router hardware, ISP behavior, VPN recovery, and application retry mechanisms.

## 7. WAN2 Traffic Shaping and Guest Wi-Fi Restriction

During backup WAN operation, the available cellular bandwidth must be protected for critical business operations.

### Normal WAN1 Operation

- Guest Wi-Fi is limited to a maximum of 2 Mbps per client.
- POS, kiosk, management, and fleet telemetry traffic receive higher priority.
- Guest traffic is assigned the lowest QoS priority.

### Backup WAN2 Operation

When ISP-1 fails and ISP-2 becomes active:

- Apply a VLAN 50 aggregate shaper or policer.
- Set the maximum aggregate guest Wi-Fi bandwidth to 120 kbps.
- Drop or throttle guest traffic exceeding the configured limit.
- Preserve priority for POS, kiosk, network management, and fleet telemetry traffic.
- If required, temporarily disable guest internet access entirely.

The 120 kbps aggregate limit is below the assessment requirement of 128 kbps.

CCTV video streaming may become unavailable under this constrained backup condition. Retain essential alarm and event traffic where technically possible.

## 8. Network Validation Checklist

The proposed architecture must be validated on the deployed network equipment.

| Test | Expected Result |
|---|---|
| VLAN tagging | Each endpoint receives the correct VLAN assignment |
| DHCP allocation | Clients receive addresses from the correct DHCP scope |
| POS QoS | VLAN 20 receives the highest configured business priority and DSCP EF treatment |
| Guest isolation | Guest clients cannot access internal subnets or each other |
| IoT security | VLAN 40 reaches only approved telemetry and NVR services |
| Inter-VLAN ACL | Unauthorized cross-VLAN communication is denied |
| WAN1 failure | Router activates WAN2 within the target failover time |
| WAN recovery | Primary route returns without unstable connection flapping |
| WAN2 shaping | VLAN 50 aggregate traffic remains below 128 kbps |
| VPN recovery | HQ Renon and Cloud Management connectivity recovers after failover |

## 9. Implementation Limitations

This document describes the proposed logical architecture and configuration policies. No physical router, switch, firewall, or ISP failover test was performed as part of this software assessment.

The following items require validation during deployment:

- Actual VLAN and DHCP configuration.
- Inter-VLAN firewall and ACL enforcement.
- DSCP and QoS behavior on the selected network hardware.
- Dual-WAN failover and recovery timing.
- WAN2 guest traffic shaping.
- VPN and cloud service recovery under packet loss and high jitter.

The architecture is intended to reduce the impact of branch network outages while prioritizing POS transactions, fleet telemetry, and critical business connectivity.