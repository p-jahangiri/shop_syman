using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Shop.Modules.Identity;
using Shop.Modules.Inventory;
using Shop.Modules.Sales;
using Shop.Modules.Credit;

public sealed class OrderShipmentCoordinator(IServiceProvider services, OrderShipmentService shipments, SalesTransactionCoordinator reads)
{
    public Task<AdminShipmentData> ReadAdminAsync(string owner, string order, CancellationToken ct) => reads.RunAsync(() => shipments.ReadAdminAsync(owner, order, ct), inventoryOnly: false, ct: ct);
    public Task<CustomerShipmentData> ReadCustomerAsync(string owner, string order, CancellationToken ct) => reads.RunAsync(() => shipments.ReadCustomerAsync(owner, order, ct), inventoryOnly: false, ct: ct);
    public Task<ShipmentCommandResult> ApplyAsync(string actor, string order, ShipmentCommandInput input, CancellationToken ct)
    {
        var identity = services.GetRequiredService<IdentityDbContext>(); var transaction = identity.Database.CurrentTransaction?.GetDbTransaction();
        if (transaction?.IsolationLevel != IsolationLevel.Serializable) throw new InvalidOperationException("Shipment writes require the shared administrative audit transaction.");
        foreach (var type in new[] { typeof(SalesDbContext), typeof(InventoryDbContext), typeof(CreditDbContext) }) {
            var db = (DbContext)services.GetRequiredService(type);
            if (!ReferenceEquals(db.Database.CurrentTransaction?.GetDbTransaction(), transaction) || !ReferenceEquals(db.Database.GetDbConnection(), identity.Database.GetDbConnection())) throw new InvalidOperationException("Shipment participants must share the audit transaction and connection.");
        }
        return shipments.ApplyAsync(actor, order, input, ct);
    }
}
