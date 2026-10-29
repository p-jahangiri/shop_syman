import { api, save, ApiError } from './api';
import { adminViewRevision } from './admin-view-authority';
import { readStockApplication, type StockApplyCommand } from './accounting-stock-contract';
import {
  beginStockCommand,
  finishStockCommand,
  failStockCommand,
  readStockJournal,
} from './accounting-stock-journal';
export async function sendStockApplication(
  owner: string,
  command: StockApplyCommand,
  fresh = false,
) {
  const revision = adminViewRevision();
  try {
    beginStockCommand(owner, command);
    command = readStockJournal(owner)!.command;
  } catch {
    return;
  }
  try {
    const value = readStockApplication(
      await save<unknown>(
        '/admin/accounting/holoo/imports/' + command.batchId + '/stock-commands',
        command.input,
      ),
      command,
    );
    if (adminViewRevision() === revision) finishStockCommand(owner, command, value);
  } catch (error) {
    if (adminViewRevision() === revision) {
      const rejected =
        fresh &&
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 429].includes(error.status);
      failStockCommand(
        owner,
        command,
        rejected ? 'rejected' : 'unknown',
        error instanceof Error ? error.message : 'نتیجهٔ فرمان موجودی قابل تأیید نیست.',
      );
    }
  }
}
export async function recoverStockApplication(owner: string, command: StockApplyCommand) {
  const revision = adminViewRevision();
  try {
    beginStockCommand(owner, command);
    command = readStockJournal(owner)!.command;
  } catch {
    return;
  }
  try {
    const value = readStockApplication(
      await api<unknown>(
        '/admin/accounting/holoo/imports/' +
          command.batchId +
          '/stock-commands/' +
          command.input.commandId,
      ),
      command,
    );
    if (adminViewRevision() === revision) finishStockCommand(owner, command, value);
  } catch (error) {
    if (adminViewRevision() === revision)
      failStockCommand(
        owner,
        command,
        'unknown',
        error instanceof Error
          ? error.message
          : 'رسید در دسترس نیست؛ پیدا نشدن آن ثبت‌نشدن فرمان را ثابت نمی‌کند.',
      );
  }
}
