export {
  adminShipmentSchema,
  shipmentInputSchema,
  shipmentResultSchema,
  readAdminShipment,
  readShipmentResult,
  shipmentTicks,
  type AdminShipment,
  type ShipmentInput,
  type ShipmentResult,
  type ShipmentCommand,
} from '../../storefront/lib/order-shipment-contract.ts';
const id = (x: string) => {
  if (!/^[a-f0-9]{32}$/.test(x)) throw Error('شناسهٔ سفارش یا فرمان معتبر نیست.');
  return x;
};
const owner = (x: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(x)) throw Error('شناسهٔ مشتری معتبر نیست.');
  return x;
};
export const shipmentReadPath = (customer: string, order: string) =>
  `/admin/orders/${owner(customer)}/${id(order)}/shipment`;
export const shipmentWritePath = (order: string) => `/admin/orders/${id(order)}/shipment/commands`;
export const shipmentReceiptPath = (order: string, command: string) =>
  `${shipmentWritePath(order)}/${id(command)}`;
