# Compliance checklist (before selling medicines online)

This software provides controls (licences on stores, prescription review, schedule classes, batch/expiry tracking, audit logs, data retention), but **the software is not proof of legal compliance**. Review these with a pharmacy-law practitioner and a chartered accountant:

## Pharmacy and drugs
- Retail and wholesale drug licences (Forms 20/21 and 20B/21B under the Drugs and Cosmetics Rules) for every store, with a registered pharmacist present; record them in Admin → Stores.
- Rules for e-pharmacy in India are still evolving (draft e-pharmacy rules were published in 2018; check the current position with the Bihar drug control authority and CDSCO before launching online sales).
- Schedule H / H1 / X and NDPS medicines: set the correct class on each product. The platform blocks Schedule X / narcotics online and requires pharmacist verification for Rx items; maintain the Schedule H1 register and X records as the law requires.
- Do not substitute medicines without the prescriber's/patient's consent and pharmacist verification (the platform never substitutes automatically).
- Advertising: the Drugs and Magic Remedies (Objectionable Advertisements) Act and related rules – the ad module blocks obvious cure claims, but every ad must be reviewed by staff.
- Cold-chain items: mark them and only deliver where cold-chain handling exists.

## Tax and commerce
- GST registration per state; invoices show GSTIN, HSN and tax – confirm HSN codes and rates with your CA.
- Consumer Protection (E-Commerce) Rules 2020: display seller details, grievance officer, return/refund policy, MRP and country of origin where applicable.

## Data protection
- Digital Personal Data Protection Act 2023 and its rules: notice and consent, purpose limitation, retention, breach reporting, a grievance contact; prescriptions are sensitive health data – the platform stores them outside the public folder and shows them only to the customer and authorised pharmacists.
- Delivery GPS is collected only during active deliveries and auto-deleted (default 7 days).

## Payments
- PhonePe merchant agreement; RBI rules for payment aggregators apply to PhonePe, not to you, but keep reconciliation records.
- Never store card or UPI PINs – the platform never asks for them.
