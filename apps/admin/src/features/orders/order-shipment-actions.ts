import { api, save, ApiError } from '../../api/api';
import { adminViewRevision } from '../../auth/admin-view-authority';
import {
  readShipmentResult,
  shipmentWritePath,
  shipmentReceiptPath,
  type ShipmentCommand,
} from '../../api/contracts/orders/order-shipment-contract';
import {
  beginShipmentCommand,
  finishShipmentCommand,
  failShipmentCommand,
  readShipmentJournal,
} from '../../state/orders/order-shipment-journal';
export async function sendShipment(owner: string, command: ShipmentCommand, fresh = false) {
  const revision = adminViewRevision();
  try {
    beginShipmentCommand(owner, command);
    command = readShipmentJournal(owner)!.command;
  } catch {
    return;
  }
  try {
    const value = readShipmentResult(
      await save<unknown>(shipmentWritePath(command.orderId), command.input),
      command,
    );
    if (adminViewRevision() === revision) finishShipmentCommand(owner, command, value);
  } catch (error) {
    if (adminViewRevision() === revision) {
      const rejected =
        fresh &&
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 429].includes(error.status);
      failShipmentCommand(
        owner,
        command,
        rejected ? 'rejected' : 'unknown',
        error instanceof Error ? error.message : 'نتیجهٔ فرمان ارسال قابل تأیید نیست.',
      );
    }
  }
}
export async function recoverShipment(owner: string, command: ShipmentCommand) {
  const revision = adminViewRevision();
  try {
    beginShipmentCommand(owner, command);
    command = readShipmentJournal(owner)!.command;
  } catch {
    return;
  }
  try {
    const value = readShipmentResult(
      await api<unknown>(shipmentReceiptPath(command.orderId, command.input.commandId)),
      command,
    );
    if (adminViewRevision() === revision) finishShipmentCommand(owner, command, value);
  } catch (error) {
    if (adminViewRevision() === revision)
      failShipmentCommand(
        owner,
        command,
        'unknown',
        error instanceof Error
          ? error.message
          : 'رسید در دسترس نیست؛ پیدا نشدن رسید، ثبت‌نشدن فرمان را ثابت نمی‌کند.',
      );
  }
}
