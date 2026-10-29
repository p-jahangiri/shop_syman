// Only an account-bound command identifier survives a reload; credentials and
// personal fields never enter browser storage. The receipt is always re-read.
const prefix = 'sayman.staff-creation.v1.';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export interface StaffCreationStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function readStaffCreationCommand(store: StaffCreationStore, owner: string) {
  const value = store.getItem(prefix + owner);
  if (value === null) return null;
  if (!uuid.test(value)) throw new Error('شناسهٔ تلاش ساخت حساب معتبر نیست؛ بررسی فنی لازم است.');
  return value;
}
export function rememberStaffCreationCommand(store: StaffCreationStore, owner: string, id: string) {
  if (!owner || !uuid.test(id)) throw new Error('شناسهٔ ساخت حساب معتبر نیست.');
  store.setItem(prefix + owner, id);
  if (readStaffCreationCommand(store, owner) !== id)
    throw new Error('شناسهٔ تلاش در مرورگر حفظ نشد؛ ساخت حساب ارسال نشد.');
}
export function clearStaffCreationCommand(store: StaffCreationStore, owner: string, id: string) {
  if (readStaffCreationCommand(store, owner) === id) store.removeItem(prefix + owner);
}
