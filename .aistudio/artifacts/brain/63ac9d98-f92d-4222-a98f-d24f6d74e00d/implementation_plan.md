# Vision for Spare Parts & Inventory Control

This document outlines the architectural vision and implementation details for ensuring inventory accuracy and financial integrity regarding spare parts used in maintenance procedures.

## 1. Zero-Billing for Non-Successful Maintenance
The system ensures that customers are only billed for spare parts when a repair is successful.
- **Failed Repair (لم يتم الإصلاح)**: When a device is marked as "Failed", any spare parts previously associated with it (from inspection or maintenance staging) are automatically cleared. The billable cost for these parts is set to 0.
- **Customer Refused (لم يوافق العميل)**: Similar to failed repairs, a refusal by the customer triggers an automatic removal of spare parts from the record, ensuring no financial impact on the invoice.
- **Scrap Parts (تشليح)**: Parts identified as "Scrap" (taken from old devices) are recorded for technical documentation but are excluded from financial totals and inventory deductions.

## 2. Inventory Protection Mechanism
Deductions from the `shop_parts_inventory` are deferred until the final "Repaired" state is committed.
- **Successful Repair**: Only when the maintenance outcome is "Repaired" (تم الإصلاح) are the quantities deducted from stock.
- **Negative Stock Support**: The system allows for negative stock to handle cases where inventory was not updated before use, while flagging these items in red for audit.

## 3. Automatic Restoration (Cascading Rollback)
To ensure stock levels remain accurate even when actions are reversed, a "Cascading Restoration" service handles the following scenarios:
- **Invoice Deletion**: Deleting an entire invoice that reached status 50/60 automatically restores all used spare parts back to available inventory.
- **Device Deletion**: Removing a specific device from an invoice restores its parts to stock.
- **Status Reversal**: If an invoice or item is moved from "Ready/Delivered" (50/60) back to an earlier stage (e.g., back to inspection or awaiting approval), the system assumes the parts usage is no longer final and restores them to inventory.

## 4. Implementation Details
- **Service Layer**: `src/lib/invoiceCascadeService.ts` contains the `restoreItemSparePartsToStock` function which tracks `usedQuantity` and `quantity` fields.
- **UI Integration**:
    - `Inspection.tsx`: Restricts part selection to "Maintenance" decision only. Clears parts if the decision changes to "Intact" or "Unrepairable".
    - `Maintenance.tsx`: Explicitly clears parts and costs if the outcome is failed or refused.
    - `Invoices.tsx`: Intercepts status changes and deletions to trigger inventory restoration.
- **Visibility**: Spare parts are displayed in light font under device data in temporary tables for easy verification during the procedure.
- **Documentation**: Spare parts usage is included in printed Inspection and Maintenance reports on a separate line under the Technical Report column.
